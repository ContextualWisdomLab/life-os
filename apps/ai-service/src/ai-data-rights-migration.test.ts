import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

const DATABASE_URL =
  process.env.AI_TEST_DATABASE_URL ?? process.env.AI_DATABASE_URL;
const TEMPORARY_DATABASE_NAME = 'life_os_ai_data_rights_test';
const DROP_TEMPORARY_DATABASE_SQL =
  'DROP DATABASE IF EXISTS life_os_ai_data_rights_test WITH (FORCE)';
const CREATE_TEMPORARY_DATABASE_SQL =
  'CREATE DATABASE life_os_ai_data_rights_test';
const DROP_FIXTURE_ROLE_SQL =
  'DROP ROLE IF EXISTS life_os_ai_data_rights_runtime_test';
const CREATE_FIXTURE_ROLE_SQL =
  'CREATE ROLE life_os_ai_data_rights_runtime_test NOLOGIN';
const SET_FIXTURE_ROLE_SQL = 'SET ROLE life_os_ai_data_rights_runtime_test';
const GRANT_FIXTURE_SCHEMA_SQL =
  'GRANT USAGE ON SCHEMA ai TO life_os_ai_data_rights_runtime_test';
const GRANT_FIXTURE_TABLES_SQL =
  'GRANT SELECT, DELETE ON ai.proposal_audit_records, ai.proposal_decision_events TO life_os_ai_data_rights_runtime_test';
const GRANT_FIXTURE_ERASURE_FUNCTION_SQL =
  'GRANT EXECUTE ON FUNCTION ai.erase_workspace_data(uuid, uuid, uuid, uuid) TO life_os_ai_data_rights_runtime_test';
const DATABASE_DISCONNECT_TIMEOUT_MS = 2_000;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const LOCK_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const CONFLICTING_REQUEST_ID = '66666666-6666-4666-8666-666666666666';
const IDEMPOTENCY_KEY = '77777777-7777-4777-8777-777777777777';
const SECOND_IDEMPOTENCY_KEY = '88888888-8888-4888-8888-888888888888';
const INVALID_VERSION_UUID = '99999999-9999-1999-8999-999999999999';
const RUNTIME_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUNTIME_REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RUNTIME_IDEMPOTENCY_KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ERASE_SQL = `SELECT
  result_erased_records AS erased_records,
  result_receipt_sha256 AS receipt_sha256
FROM ai.erase_workspace_data($1, $2, $3, $4)`;

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('AI_TEST_DATABASE_URL or AI_DATABASE_URL is required');
  }
  return DATABASE_URL;
}

function databaseUrl(sourceUrl: string, name: string): string {
  const parsed = new URL(sourceUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Drops the disposable database only after orderly pool shutdown reaches PostgreSQL. */
async function dropTemporaryDatabaseWhenIdle(adminPool: Pool): Promise<void> {
  if (TEMPORARY_DATABASE_NAME !== 'life_os_ai_data_rights_test') {
    throw new Error('Unexpected AI data-rights fixture database name');
  }
  const deadline = Date.now() + DATABASE_DISCONNECT_TIMEOUT_MS;
  while (Date.now() <= deadline) {
    const activeConnections = await adminPool.query<{ count: number }>(
      `SELECT count(*)::integer AS count
       FROM pg_stat_activity
       WHERE datname = $1`,
      [TEMPORARY_DATABASE_NAME],
    );
    if (activeConnections.rows[0]?.count === 0) {
      await adminPool.query(DROP_TEMPORARY_DATABASE_SQL);
      return;
    }
    await sleep(25);
  }
  throw new Error('AI data-rights fixture database did not become idle');
}

async function applyAiMigrations(pool: Pool): Promise<void> {
  for (const migrationFile of [
    '0001_proposal_audit.sql',
    '0002_data_rights_erasure.sql',
  ]) {
    const sql = await readFile(
      resolve(__dirname, '../migrations', migrationFile),
      'utf8',
    );
    await pool.query(sql);
  }
}

async function seedWorkspace(
  pool: Pool,
  workspaceId: string,
  suffix: string,
): Promise<void> {
  const proposalId = `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(
    3,
  )}-8${suffix.repeat(3)}-${suffix.repeat(12)}`;
  const decisionId = `${suffix.repeat(7)}1-${suffix.repeat(4)}-4${suffix.repeat(
    3,
  )}-8${suffix.repeat(3)}-${suffix.repeat(12)}`;
  const idempotencyKey = `${suffix.repeat(7)}2-${suffix.repeat(
    4,
  )}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`;
  const digest = suffix.repeat(64);
  const now = '2026-08-12T00:00:00.000Z';

  await pool.query(
    `INSERT INTO ai.proposal_audit_records (
       proposal_id,
       workspace_id,
       model_id,
       request_json,
       request_digest,
       summary,
       rationale_json,
       operations_json,
       requires_confirmation,
       content_digest,
       created_at,
       recorded_at
     ) VALUES (
       $1,
       $2,
       'rule-based-v1',
       '{"goal":"example"}'::jsonb,
       $3,
       'Example proposal',
       '["because"]'::jsonb,
       '[{"kind":"noop"}]'::jsonb,
       true,
       $3,
       $4,
       $4
     )`,
    [proposalId, workspaceId, digest, now],
  );
  await pool.query(
    `INSERT INTO ai.proposal_decision_events (
       id,
       workspace_id,
       proposal_id,
       proposal_content_digest,
       actor_id,
       decision_kind,
       reason_text,
       idempotency_key,
       decided_at,
       recorded_at
     ) VALUES ($1, $2, $3, $4, $5, 'accepted', 'confirmed', $6, $7, $7)`,
    [
      decisionId,
      workspaceId,
      proposalId,
      digest,
      USER_ID,
      idempotencyKey,
      now,
    ],
  );
}

/** Runs one statement under the deliberately under-privileged fixture role. */
async function asFixtureRole(
  pool: Pool,
  operation: (client: PoolClient) => Promise<unknown>,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(SET_FIXTURE_ROLE_SQL);
    await operation(client);
  } finally {
    await client.query('RESET ROLE').catch(() => undefined);
    client.release();
  }
}

async function expectSqlState(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(error).toMatchObject({ code: expectedCode });
    return;
  }
  throw new Error(`Expected PostgreSQL error ${expectedCode}`);
}

describe('AI data-rights erasure database contract', () => {
  it('uses workspace serialization and owner-only transaction-local trigger authorization', async () => {
    const sql = await readFile(
      resolve(__dirname, '../migrations/0002_data_rights_erasure.sql'),
      'utf8',
    );
    expect(sql).toContain("'ai.service:erase:' || target_workspace_id::text");
    expect(sql).not.toContain(
      "target_workspace_id::text || ':' || target_idempotency_key::text",
    );
    expect(sql).toContain('CREATE TABLE ai.data_rights_erasure_authorizations');
    expect(sql).toContain('pg_current_xact_id()');
    expect(sql).not.toContain('DISABLE TRIGGER');
    expect(sql).not.toContain('ENABLE TRIGGER');
  });
});

describeWithDatabase('PostgreSQL AI data-rights lifecycle', () => {
  it('serializes, erases, replays, verifies least privilege and preserves append-only triggers', async () => {
    const sourceUrl = requireDatabaseUrl();
    const adminPool = new Pool({
      connectionString: databaseUrl(sourceUrl, 'postgres'),
    });
    let migrationPool: Pool | undefined;
    let lockClient: PoolClient | undefined;
    let contenderClient: PoolClient | undefined;
    let primaryFailure: unknown;
    let cleanupError: AggregateError | undefined;

    try {
      await dropTemporaryDatabaseWhenIdle(adminPool);
      await adminPool.query(DROP_FIXTURE_ROLE_SQL);
      await adminPool.query(CREATE_FIXTURE_ROLE_SQL);
      await adminPool.query(CREATE_TEMPORARY_DATABASE_SQL);
      const temporaryUrl = databaseUrl(sourceUrl, TEMPORARY_DATABASE_NAME);
      migrationPool = new Pool({ connectionString: temporaryUrl, max: 8 });
      await applyAiMigrations(migrationPool);
      await migrationPool.query(GRANT_FIXTURE_SCHEMA_SQL);
      await migrationPool.query(GRANT_FIXTURE_TABLES_SQL);
      await seedWorkspace(migrationPool, WORKSPACE_ID, 'a');
      await seedWorkspace(migrationPool, OTHER_WORKSPACE_ID, 'b');
      await seedWorkspace(migrationPool, RUNTIME_WORKSPACE_ID, 'c');

      lockClient = await migrationPool.connect();
      contenderClient = await migrationPool.connect();
      await lockClient.query('BEGIN');
      await lockClient.query(ERASE_SQL, [
        LOCK_WORKSPACE_ID,
        USER_ID,
        REQUEST_ID,
        IDEMPOTENCY_KEY,
      ]);
      await contenderClient.query("SET statement_timeout = '200ms'");
      await expectSqlState(
        contenderClient.query(ERASE_SQL, [
          LOCK_WORKSPACE_ID,
          USER_ID,
          CONFLICTING_REQUEST_ID,
          SECOND_IDEMPOTENCY_KEY,
        ]),
        '57014',
      );
      await contenderClient.query('SET statement_timeout = 0');
      await expect(
        contenderClient.query(
          'SELECT count(*)::integer AS count FROM ai.proposal_audit_records',
        ),
      ).resolves.toMatchObject({ rows: [{ count: 3 }] });
      await lockClient.query('ROLLBACK');
      lockClient.release();
      lockClient = undefined;
      contenderClient.release();
      contenderClient = undefined;

      await asFixtureRole(migrationPool, async (client) => {
        await expectSqlState(
          client.query(
            'DELETE FROM ai.proposal_decision_events WHERE workspace_id = $1',
            [OTHER_WORKSPACE_ID],
          ),
          '55000',
        );
        await expectSqlState(
          client.query(ERASE_SQL, [
            RUNTIME_WORKSPACE_ID,
            USER_ID,
            RUNTIME_REQUEST_ID,
            RUNTIME_IDEMPOTENCY_KEY,
          ]),
          '42501',
        );
        await expectSqlState(
          client.query(
            `INSERT INTO ai.data_rights_erasure_authorizations
               (backend_process_id, transaction_id, workspace_id)
             VALUES (pg_backend_pid(), pg_current_xact_id(), $1)`,
            [OTHER_WORKSPACE_ID],
          ),
          '42501',
        );
        await expectSqlState(
          client.query(
            `INSERT INTO ai.data_rights_erasure_receipts (
               workspace_id,
               idempotency_key,
               request_id,
               requested_by_user_id,
               erased_records,
               receipt_sha256,
               erased_at
             ) VALUES ($1, $2, $3, $4, 0, $5, transaction_timestamp())`,
            [
              OTHER_WORKSPACE_ID,
              RUNTIME_IDEMPOTENCY_KEY,
              RUNTIME_REQUEST_ID,
              USER_ID,
              'd'.repeat(64),
            ],
          ),
          '42501',
        );
      });

      await migrationPool.query(GRANT_FIXTURE_ERASURE_FUNCTION_SQL);
      await asFixtureRole(migrationPool, async (client) => {
        const privileges = await client.query<{
          function_ready: boolean;
          receipt_insert_ready: boolean;
          receipt_select_ready: boolean;
        }>(
          `SELECT
             has_function_privilege(
               current_user,
               'ai.erase_workspace_data(uuid,uuid,uuid,uuid)',
               'EXECUTE'
             ) AS function_ready,
             has_table_privilege(
               current_user,
               'ai.data_rights_erasure_receipts',
               'INSERT'
             ) AS receipt_insert_ready,
             has_table_privilege(
               current_user,
               'ai.data_rights_erasure_receipts',
               'SELECT'
             ) AS receipt_select_ready`,
        );
        expect(privileges.rows).toEqual([
          {
            function_ready: true,
            receipt_insert_ready: false,
            receipt_select_ready: false,
          },
        ]);

        const runtimeErasure = await client.query<{
          erased_records: number;
          receipt_sha256: string;
        }>(ERASE_SQL, [
          RUNTIME_WORKSPACE_ID,
          USER_ID,
          RUNTIME_REQUEST_ID,
          RUNTIME_IDEMPOTENCY_KEY,
        ]);
        expect(runtimeErasure.rows[0]).toMatchObject({ erased_records: 2 });
        expect(runtimeErasure.rows[0]?.receipt_sha256).toMatch(
          /^[0-9a-f]{64}$/u,
        );
        await expectSqlState(
          client.query(
            `INSERT INTO ai.data_rights_erasure_receipts (
               workspace_id,
               idempotency_key,
               request_id,
               requested_by_user_id,
               erased_records,
               receipt_sha256,
               erased_at
             ) VALUES ($1, $2, $3, $4, 0, $5, transaction_timestamp())`,
            [
              OTHER_WORKSPACE_ID,
              RUNTIME_IDEMPOTENCY_KEY,
              RUNTIME_REQUEST_ID,
              USER_ID,
              'd'.repeat(64),
            ],
          ),
          '42501',
        );
      });

      const erased = await migrationPool.query<{
        erased_records: number;
        receipt_sha256: string;
      }>(ERASE_SQL, [WORKSPACE_ID, USER_ID, REQUEST_ID, IDEMPOTENCY_KEY]);
      expect(erased.rows[0]).toMatchObject({ erased_records: 2 });
      expect(erased.rows[0]?.receipt_sha256).toMatch(/^[0-9a-f]{64}$/u);

      const replayed = await migrationPool.query(ERASE_SQL, [
        WORKSPACE_ID,
        USER_ID,
        REQUEST_ID,
        IDEMPOTENCY_KEY,
      ]);
      expect(replayed.rows).toEqual(erased.rows);
      await expectSqlState(
        migrationPool.query(ERASE_SQL, [
          WORKSPACE_ID,
          USER_ID,
          CONFLICTING_REQUEST_ID,
          IDEMPOTENCY_KEY,
        ]),
        '23505',
      );
      await expectSqlState(
        migrationPool.query(ERASE_SQL, [
          INVALID_VERSION_UUID,
          USER_ID,
          REQUEST_ID,
          SECOND_IDEMPOTENCY_KEY,
        ]),
        '22023',
      );

      const persisted = await migrationPool.query<{
        receipt_count: number;
        runtime_receipt_count: number;
        authorization_count: number;
        erased_workspace_records: number;
        runtime_workspace_records: number;
        other_workspace_records: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
              FROM ai.data_rights_erasure_receipts
             WHERE workspace_id = $1) AS receipt_count,
           (SELECT count(*)::integer
              FROM ai.data_rights_erasure_receipts
             WHERE workspace_id = $2) AS runtime_receipt_count,
           (SELECT count(*)::integer
              FROM ai.data_rights_erasure_authorizations) AS authorization_count,
           (
             (SELECT count(*) FROM ai.proposal_audit_records WHERE workspace_id = $1) +
             (SELECT count(*) FROM ai.proposal_decision_events WHERE workspace_id = $1)
           )::integer AS erased_workspace_records,
           (
             (SELECT count(*) FROM ai.proposal_audit_records WHERE workspace_id = $2) +
             (SELECT count(*) FROM ai.proposal_decision_events WHERE workspace_id = $2)
           )::integer AS runtime_workspace_records,
           (
             (SELECT count(*) FROM ai.proposal_audit_records WHERE workspace_id = $3) +
             (SELECT count(*) FROM ai.proposal_decision_events WHERE workspace_id = $3)
           )::integer AS other_workspace_records`,
        [WORKSPACE_ID, RUNTIME_WORKSPACE_ID, OTHER_WORKSPACE_ID],
      );
      expect(persisted.rows[0]).toEqual({
        receipt_count: 1,
        runtime_receipt_count: 1,
        authorization_count: 0,
        erased_workspace_records: 0,
        runtime_workspace_records: 0,
        other_workspace_records: 2,
      });

      const triggers = await migrationPool.query<{
        trigger_name: string;
        trigger_enabled: string;
      }>(
        `SELECT tgname AS trigger_name, tgenabled AS trigger_enabled
         FROM pg_trigger
         WHERE tgname IN (
           'proposal_audit_records_append_only',
           'proposal_decision_events_append_only'
         )
         ORDER BY tgname ASC`,
      );
      expect(triggers.rows).toEqual([
        {
          trigger_name: 'proposal_audit_records_append_only',
          trigger_enabled: 'O',
        },
        {
          trigger_name: 'proposal_decision_events_append_only',
          trigger_enabled: 'O',
        },
      ]);
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      const cleanupFailures: unknown[] = [];
      const cleanups: Array<() => Promise<unknown>> = [
        async () => {
          if (lockClient !== undefined) {
            await lockClient.query('ROLLBACK').catch(() => undefined);
            lockClient.release();
            lockClient = undefined;
          }
        },
        async () => {
          if (contenderClient !== undefined) {
            await contenderClient
              .query('SET statement_timeout = 0')
              .catch(() => undefined);
            contenderClient.release();
            contenderClient = undefined;
          }
        },
        async () => await migrationPool?.end(),
        async () => await dropTemporaryDatabaseWhenIdle(adminPool),
        async () => await adminPool.query(DROP_FIXTURE_ROLE_SQL),
        async () => await adminPool.end(),
      ];
      for (const cleanup of cleanups) {
        try {
          await cleanup();
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      if (cleanupFailures.length > 0) {
        cleanupError = new AggregateError(
          cleanupFailures,
          'AI data-rights test cleanup failed',
        );
        if (
          primaryFailure instanceof Error &&
          primaryFailure.cause === undefined
        ) {
          Object.defineProperty(primaryFailure, 'cause', {
            configurable: true,
            value: cleanupError,
          });
        }
      }
    }
    if (cleanupError !== undefined && primaryFailure === undefined) {
      throw cleanupError;
    }
  }, 30_000);
});
