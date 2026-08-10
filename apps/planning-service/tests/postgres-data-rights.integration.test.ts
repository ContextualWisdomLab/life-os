import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION } from '../src/planning-data-rights';
import {
  createPlanningRuntime,
  type PlanningRuntime,
} from '../src/planning-runtime';

const DATABASE_URL = process.env.PLANNING_DATABASE_URL;
const TEMPORARY_DATABASE_NAME = 'life_os_data_rights_test';
const DROP_TEMPORARY_DATABASE_SQL =
  'DROP DATABASE IF EXISTS life_os_data_rights_test WITH (FORCE)';
const DATABASE_DISCONNECT_TIMEOUT_MS = 2_000;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const CONFLICTING_REQUEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('PLANNING_DATABASE_URL is required for PostgreSQL integration tests');
  }
  return DATABASE_URL;
}

function databaseUrl(sourceUrl: string, name: string): string {
  const parsed = new URL(sourceUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Drops the fixture database only after every orderly pool shutdown reaches PostgreSQL. */
async function dropTemporaryDatabaseWhenIdle(adminPool: Pool): Promise<void> {
  if (TEMPORARY_DATABASE_NAME !== 'life_os_data_rights_test') {
    throw new Error('Unexpected Planning data-rights fixture database name');
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
  throw new Error('Planning data-rights fixture database did not become idle');
}

async function applyPlanningMigrations(pool: Pool): Promise<void> {
  for (const migrationFile of [
    '0001_initial_planning.sql',
    '0002_durable_repository_contract.sql',
    '0003_durable_today_sync.sql',
    '0004_data_rights_erasure_receipts.sql',
  ]) {
    const sql = await readFile(
      resolve(__dirname, '../migrations', migrationFile),
      'utf8',
    );
    await pool.query(sql);
  }
}

async function seedWorkspace(pool: Pool): Promise<void> {
  const goalId = '55555555-5555-4555-8555-555555555555';
  const projectId = '66666666-6666-4666-8666-666666666666';
  const taskId = '77777777-7777-4777-8777-777777777777';
  const aggregateId = '88888888-8888-4888-8888-888888888888';
  const revisionToken = '99999999-9999-4999-8999-999999999999';
  const todayIdempotencyKey = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const payload = {
    version: 'life-os.today.v1',
    date: '2026-08-10',
    actions: [],
  };

  await pool.query(
    `INSERT INTO planning.goals (id, workspace_id, title)
     VALUES ($1, $2, 'Goal')`,
    [goalId, WORKSPACE_ID],
  );
  await pool.query(
    `INSERT INTO planning.projects (id, workspace_id, goal_id, title)
     VALUES ($1, $2, $3, 'Project')`,
    [projectId, WORKSPACE_ID, goalId],
  );
  await pool.query(
    `INSERT INTO planning.tasks (id, workspace_id, project_id, title)
     VALUES ($1, $2, $3, 'Task')`,
    [taskId, WORKSPACE_ID, projectId],
  );
  await pool.query(
    `INSERT INTO planning.today_aggregates
       (workspace_id, local_date, aggregate_id, revision_number, revision_token, payload_json)
     VALUES ($1, DATE '2026-08-10', $2, 1, $3, $4::jsonb)`,
    [WORKSPACE_ID, aggregateId, revisionToken, JSON.stringify(payload)],
  );
  await pool.query(
    `INSERT INTO planning.today_idempotency_records
       (workspace_id, idempotency_key, request_digest, result_kind,
        aggregate_id, revision_token, payload_json)
     VALUES ($1, $2, $3, 'created', $4, $5, $6::jsonb)`,
    [
      WORKSPACE_ID,
      todayIdempotencyKey,
      'c'.repeat(64),
      aggregateId,
      revisionToken,
      JSON.stringify(payload),
    ],
  );
}

describeWithDatabase('PostgreSQL Planning data-rights lifecycle', () => {
  it('exports, erases, replays and verifies one tenant without cross-service persistence', async () => {
    const sourceUrl = requireDatabaseUrl();
    const adminPool = new Pool({
      connectionString: databaseUrl(sourceUrl, 'postgres'),
    });
    let migrationPool: Pool | undefined;
    let runtime: PlanningRuntime | undefined;
    let primaryFailure: unknown;
    let cleanupError: AggregateError | undefined;

    try {
      await dropTemporaryDatabaseWhenIdle(adminPool);
      await adminPool.query('CREATE DATABASE life_os_data_rights_test');
      const temporaryUrl = databaseUrl(sourceUrl, TEMPORARY_DATABASE_NAME);
      migrationPool = new Pool({ connectionString: temporaryUrl });
      await applyPlanningMigrations(migrationPool);
      await seedWorkspace(migrationPool);
      runtime = createPlanningRuntime({
        PLANNING_DATABASE_URL: temporaryUrl,
        PLANNING_DATABASE_POOL_MAX: '4',
        PLANNING_DATABASE_CONNECT_TIMEOUT_MS: '5000',
        PLANNING_DATABASE_IDLE_TIMEOUT_MS: '1000',
      });

      const preflight = await runtime.dataRightsContributor.handle({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'erase_preflight',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        requestId: REQUEST_ID,
      });
      expect(preflight).toMatchObject({
        operation: 'erase_preflight',
        ready: true,
        blockers: [],
      });

      const exported = await runtime.dataRightsContributor.handle({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'export',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        requestId: REQUEST_ID,
      });
      expect(exported).toMatchObject({
        operation: 'export',
        schemaVersion: 'planning.data-rights.v1',
        recordCount: 5,
      });
      if (exported.operation !== 'export') {
        throw new Error('Expected Planning export response');
      }
      expect(exported.sha256).toMatch(/^[0-9a-f]{64}$/u);

      const erased = await runtime.dataRightsContributor.handle({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'erase',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        requestId: REQUEST_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
      });
      expect(erased).toMatchObject({
        operation: 'erase',
        erasedRecords: 5,
      });
      if (erased.operation !== 'erase') {
        throw new Error('Expected Planning erasure response');
      }
      expect(erased.receiptSha256).toMatch(/^[0-9a-f]{64}$/u);

      await expect(
        runtime.dataRightsContributor.handle({
          contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
          operation: 'erase',
          workspaceId: WORKSPACE_ID,
          requestedByUserId: USER_ID,
          requestId: REQUEST_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      ).resolves.toEqual(erased);

      await expect(
        runtime.dataRightsContributor.handle({
          contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
          operation: 'erase',
          workspaceId: WORKSPACE_ID,
          requestedByUserId: USER_ID,
          requestId: CONFLICTING_REQUEST_ID,
          idempotencyKey: IDEMPOTENCY_KEY,
        }),
      ).rejects.toThrow('idempotency key conflicts with prior authority');

      await expect(
        runtime.dataRightsContributor.handle({
          contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
          operation: 'verify_erased',
          workspaceId: WORKSPACE_ID,
          requestedByUserId: USER_ID,
          requestId: REQUEST_ID,
        }),
      ).resolves.toMatchObject({
        operation: 'verify_erased',
        erased: true,
      });

      const persisted = await migrationPool.query<{
        receipt_count: number;
        remaining_count: number;
      }>(
        `SELECT
           (SELECT count(*)::integer
              FROM planning.data_rights_erasure_receipts
             WHERE workspace_id = $1) AS receipt_count,
           (
             (SELECT count(*) FROM planning.goals WHERE workspace_id = $1) +
             (SELECT count(*) FROM planning.projects WHERE workspace_id = $1) +
             (SELECT count(*) FROM planning.tasks WHERE workspace_id = $1) +
             (SELECT count(*) FROM planning.today_aggregates WHERE workspace_id = $1) +
             (SELECT count(*) FROM planning.today_idempotency_records WHERE workspace_id = $1)
           )::integer AS remaining_count`,
        [WORKSPACE_ID],
      );
      expect(persisted.rows[0]).toEqual({
        receipt_count: 1,
        remaining_count: 0,
      });
    } catch (error) {
      primaryFailure = error;
      throw error;
    } finally {
      const cleanupFailures: unknown[] = [];
      const cleanups: Array<() => Promise<unknown>> = [
        async () => await runtime?.close(),
        async () => await migrationPool?.end(),
        async () => await dropTemporaryDatabaseWhenIdle(adminPool),
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
          'Planning data-rights test cleanup failed',
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
