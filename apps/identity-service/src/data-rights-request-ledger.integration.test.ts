import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
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
const MIGRATION_DIRECTORY = resolve(__dirname, '../migrations');

class NodePostgresDataRightsClient implements DataRightsRequestSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<DataRightsRequestSqlResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[], rowCount: result.rowCount };
  }
}

describeWithDatabase('PostgreSQL data-rights request ledger', () => {
  let adminPool: Pool;
  let pool: Pool;

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('IDENTITY_DATABASE_URL is required for PostgreSQL integration tests');
    }
    const adminUrl = new URL(DATABASE_URL);
    adminUrl.pathname = '/postgres';
    adminPool = new Pool({ connectionString: adminUrl.toString() });
    await adminPool.query(
      'DROP DATABASE IF EXISTS life_os_data_rights_ledger_test WITH (FORCE)',
    );
    await adminPool.query('CREATE DATABASE life_os_data_rights_ledger_test');

    const testUrl = new URL(DATABASE_URL);
    testUrl.pathname = `/${TEST_DATABASE_NAME}`;
    pool = new Pool({ connectionString: testUrl.toString() });
    const migrationFiles = (await readdir(MIGRATION_DIRECTORY))
      .filter((file) => file.endsWith('.sql'))
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
    } finally {
      if (adminPool) {
        try {
          await adminPool.query(
            'DROP DATABASE IF EXISTS life_os_data_rights_ledger_test WITH (FORCE)',
          );
        } finally {
          await adminPool.end();
        }
      }
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
      `INSERT INTO identity.users (id, display_name) VALUES ($1::uuid, $2)`,
      [userId, 'Data rights integration user'],
    );
    await pool.query(
      `INSERT INTO identity.workspaces (id, owner_user_id, name, kind)
       VALUES ($1::uuid, $2::uuid, $3, 'personal')`,
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

    await pool.query(`DELETE FROM identity.workspaces WHERE id = $1::uuid`, [workspaceId]);
    await pool.query(`DELETE FROM identity.users WHERE id = $1::uuid`, [userId]);

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
      `INSERT INTO identity.users (id, display_name) VALUES ($1::uuid, $2)`,
      [userId, 'Request collision integration user'],
    );
    await pool.query(
      `INSERT INTO identity.workspaces (id, owner_user_id, name, kind)
       VALUES ($1::uuid, $2::uuid, $3, 'personal')`,
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
});
