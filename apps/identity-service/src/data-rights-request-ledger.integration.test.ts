import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DataRightsRequestConflictError,
  PostgresDataRightsRequestLedger,
  type DataRightsRequestSqlClient,
  type DataRightsRequestSqlResult,
} from './data-rights-request-ledger';

const DATABASE_URL = process.env.IDENTITY_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const TEST_DATABASE_NAME = 'life_os_data_rights_ledger_test';
const TEST_DATABASE_LOCK_KEY = 7_903_341_702;
if (!/^[a-z][a-z0-9_]*$/u.test(TEST_DATABASE_NAME)) {
  throw new Error('TEST_DATABASE_NAME must be a safe PostgreSQL identifier');
}
const DROP_TEST_DATABASE = `DROP DATABASE IF EXISTS "${TEST_DATABASE_NAME}"`;
const CREATE_TEST_DATABASE = `CREATE DATABASE "${TEST_DATABASE_NAME}"`;
const MIGRATION_DIRECTORY = resolve(__dirname, '../migrations');

class NodePostgresDataRightsClient implements DataRightsRequestSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<DataRightsRequestSqlResult<Row>> {
    const queryResult = await this.pool.query(text, [...values]);
    return { rows: queryResult.rows as Row[], rowCount: queryResult.rowCount };
  }
}

describeWithDatabase('PostgreSQL data-rights request ledger', () => {
  let adminPool: Pool;
  let adminClient: PoolClient | undefined;
  let pool: Pool;

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('IDENTITY_DATABASE_URL is required for PostgreSQL integration tests');
    }
    const adminUrl = new URL(DATABASE_URL);
    adminUrl.pathname = '/postgres';
    adminPool = new Pool({ connectionString: adminUrl.toString() });
    adminClient = await adminPool.connect();
    await adminClient.query('SELECT pg_advisory_lock($1)', [
      TEST_DATABASE_LOCK_KEY,
    ]);
    await adminClient.query(DROP_TEST_DATABASE);
    await adminClient.query(CREATE_TEST_DATABASE);

    const testUrl = new URL(DATABASE_URL);
    testUrl.pathname = `/${TEST_DATABASE_NAME}`;
    pool = new Pool({ connectionString: testUrl.toString() });
    const migrationFiles = (await readdir(MIGRATION_DIRECTORY))
      .filter((migrationFile) => migrationFile.endsWith('.sql'))
      .sort();
    for (const migrationFile of migrationFiles) {
      await pool.query(
        await readFile(resolve(MIGRATION_DIRECTORY, migrationFile), 'utf8'),
      );
    }
  }, 30_000);

  afterAll(async () => {
    try {
      if (pool) await pool.end();
      if (adminClient) await adminClient.query(DROP_TEST_DATABASE);
    } finally {
      if (adminClient) {
        try {
          await adminClient.query('SELECT pg_advisory_unlock($1)', [
            TEST_DATABASE_LOCK_KEY,
          ]);
        } finally {
          adminClient.release();
        }
      }
      if (adminPool) await adminPool.end();
    }
  });

  it('retains an immutable completion receipt after the source workspace and user are erased', async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const requestId = randomUUID();
    const idempotencyKey = randomUUID();
    const requestDigest = 'a'.repeat(64);
    const receiptDigest = 'b'.repeat(64);
    await pool.query(
      `INSERT INTO identity.user_accounts (user_account_id, display_name)
       VALUES ($1::uuid, $2)`,
      [userId, 'Data rights integration user'],
    );
    await pool.query(
      `INSERT INTO identity.identity_workspaces (
         identity_workspace_id, owner_user_account_id, workspace_name, workspace_kind
       ) VALUES ($1::uuid, $2::uuid, $3, 'personal')`,
      [workspaceId, userId, 'Data rights integration workspace'],
    );

    const ledger = new PostgresDataRightsRequestLedger(
      new NodePostgresDataRightsClient(pool),
    );
    const created = await ledger.beginRequest({
      requestId,
      workspaceId,
      requestedByUserId: userId,
      requestKind: 'erasure',
      idempotencyKey,
      requestDigest,
      requestedAt: '2026-08-09T19:40:00.000Z',
    });
    expect(created.kind).toBe('created');
    const replayed = await ledger.beginRequest({
      requestId: randomUUID(),
      workspaceId,
      requestedByUserId: userId,
      requestKind: 'erasure',
      idempotencyKey,
      requestDigest,
      requestedAt: '2026-08-09T19:41:00.000Z',
    });
    expect(replayed.kind).toBe('replayed');
    expect(replayed.request.requestId).toBe(requestId);

    await expect(
      ledger.completeRequest({
        requestId,
        workspaceId,
        receiptDigest,
        completedAt: '2026-08-09T19:45:00.000Z',
      }),
    ).resolves.toMatchObject({ kind: 'completed' });
    await expect(
      ledger.completeRequest({
        requestId,
        workspaceId,
        receiptDigest,
        completedAt: '2026-08-09T19:46:00.000Z',
      }),
    ).resolves.toMatchObject({ kind: 'replayed' });
    await expect(
      ledger.completeRequest({
        requestId,
        workspaceId,
        receiptDigest: 'c'.repeat(64),
        completedAt: '2026-08-09T19:46:00.000Z',
      }),
    ).rejects.toBeInstanceOf(DataRightsRequestConflictError);

    const blockedMutation = await pool.query(
      `UPDATE identity.data_rights_requests
       SET receipt_digest = $2
       WHERE request_id = $1::uuid`,
      [requestId, 'd'.repeat(64)],
    );
    expect(blockedMutation.rowCount).toBe(0);

    await pool.query(
      `DELETE FROM identity.identity_workspaces
       WHERE identity_workspace_id = $1::uuid`,
      [workspaceId],
    );
    await pool.query(
      `DELETE FROM identity.user_accounts WHERE user_account_id = $1::uuid`,
      [userId],
    );

    const retained = await pool.query<{
      request_id: string;
      receipt_digest: string;
      request_status: string;
    }>(
      `SELECT request_id, receipt_digest, request_status
       FROM identity.data_rights_requests
       WHERE request_id = $1::uuid`,
      [requestId],
    );
    expect(retained.rows).toEqual([
      {
        request_id: requestId,
        receipt_digest: receiptDigest,
        request_status: 'completed',
      },
    ]);
  });

  it('maps request-id reuse with a different idempotency key to a stable domain conflict', async () => {
    const userId = randomUUID();
    const workspaceId = randomUUID();
    const requestId = randomUUID();
    const firstIdempotencyKey = randomUUID();
    await pool.query(
      `INSERT INTO identity.user_accounts (user_account_id, display_name)
       VALUES ($1::uuid, $2)`,
      [userId, 'Request collision integration user'],
    );
    await pool.query(
      `INSERT INTO identity.identity_workspaces (
         identity_workspace_id, owner_user_account_id, workspace_name, workspace_kind
       ) VALUES ($1::uuid, $2::uuid, $3, 'personal')`,
      [workspaceId, userId, 'Request collision integration workspace'],
    );
    const ledger = new PostgresDataRightsRequestLedger(
      new NodePostgresDataRightsClient(pool),
    );

    await ledger.beginRequest({
      requestId,
      workspaceId,
      requestedByUserId: userId,
      requestKind: 'export',
      idempotencyKey: firstIdempotencyKey,
      requestDigest: 'c'.repeat(64),
      requestedAt: '2026-08-09T20:00:00.000Z',
    });

    await expect(
      ledger.beginRequest({
        requestId,
        workspaceId,
        requestedByUserId: userId,
        requestKind: 'export',
        idempotencyKey: randomUUID(),
        requestDigest: 'd'.repeat(64),
        requestedAt: '2026-08-09T20:01:00.000Z',
      }),
    ).rejects.toBeInstanceOf(DataRightsRequestConflictError);
  });

  it('enforces request kind, digest, completion consistency, receipt digest, and time ordering constraints', async () => {
    const baseValues = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const invalidRows: ReadonlyArray<readonly unknown[]> = [
      [
        ...baseValues,
        'invalid-kind',
        'a'.repeat(64),
        'pending',
        null,
        '2026-08-09T20:00:00.000Z',
        null,
      ],
      [
        ...baseValues,
        'export',
        'not-a-digest',
        'pending',
        null,
        '2026-08-09T20:00:00.000Z',
        null,
      ],
      [
        ...baseValues,
        'export',
        'a'.repeat(64),
        'completed',
        null,
        '2026-08-09T20:00:00.000Z',
        '2026-08-09T20:01:00.000Z',
      ],
      [
        ...baseValues,
        'export',
        'a'.repeat(64),
        'completed',
        'not-a-digest',
        '2026-08-09T20:00:00.000Z',
        '2026-08-09T20:01:00.000Z',
      ],
      [
        ...baseValues,
        'export',
        'a'.repeat(64),
        'completed',
        'b'.repeat(64),
        '2026-08-09T20:02:00.000Z',
        '2026-08-09T20:01:00.000Z',
      ],
    ];

    for (const invalidRowValues of invalidRows) {
      await expect(
        pool.query(
          `INSERT INTO identity.data_rights_requests (
             request_id, workspace_id, requested_by_user_id, idempotency_key,
             request_kind, request_digest, request_status, receipt_digest,
             requested_at, completed_at
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::uuid,
             $5, $6, $7, $8, $9::timestamptz, $10::timestamptz
           )`,
          [...invalidRowValues],
        ),
      ).rejects.toThrow();
    }
  });
});
