import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Habit, HabitCompletionEvent } from './habit-domain';
import { HabitDataRightsError } from './habit-data-rights';
import { createHabitRuntime, type HabitRuntime } from './habit-runtime';
import {
  type HabitSqlClient,
  type HabitSqlQueryResult,
  PostgresHabitRepository,
} from './postgres-habit-repository';

const DATABASE_URL = process.env.HABIT_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
let administrativePool: Pool;

class PoolSqlClient implements HabitSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }
}

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('HABIT_DATABASE_URL is required for integration tests');
  }
  return DATABASE_URL;
}

async function applyMigrations(pool: Pool): Promise<void> {
  for (const migration of [
    '0001_recurring_habit_core.sql',
    '0002_data_rights_erasure.sql',
  ]) {
    const sql = await readFile(resolve(__dirname, '../migrations', migration), 'utf8');
    await pool.query(sql);
  }
}

function repository(pool: Pool): PostgresHabitRepository {
  return new PostgresHabitRepository(new PoolSqlClient(pool));
}

function habit(workspaceId: string, title: string): Habit {
  return {
    id: randomUUID(),
    workspaceId,
    title,
    timezone: 'Asia/Seoul',
    startsOn: '2026-08-01',
    recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 3, 5] },
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function completion(storedHabit: Habit): HabitCompletionEvent {
  return {
    id: randomUUID(),
    workspaceId: storedHabit.workspaceId,
    habitId: storedHabit.id,
    scheduledLocalDate: '2026-08-10',
    completedAt: '2026-08-10T12:00:00.000Z',
    idempotencyKey: randomUUID(),
    recordedAt: '2026-08-10T12:00:01.000Z',
  };
}

async function expectAppendOnlyDeleteRejected(
  pool: Pool,
  workspaceId: string,
): Promise<void> {
  await expect(
    pool.query('DELETE FROM habit.completion_events WHERE workspace_id = $1', [
      workspaceId,
    ]),
  ).rejects.toMatchObject({ code: '55000' });
}

describeWithPostgres('Habit data-rights PostgreSQL integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-data-rights-admin',
      max: 6,
    });
  });

  beforeEach(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await applyMigrations(administrativePool);
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await administrativePool.end();
  });

  it('exports, erases, replays, verifies, and preserves another tenant', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const requestedByUserId = randomUUID();
    const requestId = randomUUID();
    const idempotencyKey = randomUUID();
    const durableRepository = repository(administrativePool);
    const ownedHabit = habit(workspaceId, 'Export and erase this habit');
    const privateHabit = habit(otherWorkspaceId, 'Preserve private tenant habit');
    const ownedCompletion = completion(ownedHabit);
    const privateCompletion = completion(privateHabit);

    await durableRepository.saveHabit(ownedHabit);
    await durableRepository.saveHabit(privateHabit);
    await durableRepository.appendCompletion(ownedCompletion);
    await durableRepository.appendCompletion(privateCompletion);

    const runtime: HabitRuntime = createHabitRuntime({
      HABIT_DATABASE_URL: requireDatabaseUrl(),
      HABIT_DATABASE_POOL_MAX: '4',
    });

    try {
      const firstExport = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'export',
        workspaceId,
        requestedByUserId,
        requestId,
      });
      expect(firstExport.operation).toBe('export');
      if (firstExport.operation !== 'export') {
        throw new Error('Expected a Habit export response');
      }
      expect(firstExport.recordCount).toBe(2);
      expect(firstExport.schemaVersion).toBe('habit.data-rights.v1');
      expect(firstExport.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(firstExport.data)).toContain(ownedHabit.id);
      expect(JSON.stringify(firstExport.data)).toContain(ownedCompletion.id);
      expect(JSON.stringify(firstExport.data)).not.toContain(privateHabit.id);
      expect(JSON.stringify(firstExport.data)).not.toContain(privateCompletion.id);

      const repeatedExport = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'export',
        workspaceId,
        requestedByUserId,
        requestId: randomUUID(),
      });
      expect(repeatedExport.operation).toBe('export');
      if (repeatedExport.operation !== 'export') {
        throw new Error('Expected a repeated Habit export response');
      }
      expect(repeatedExport.sha256).toBe(firstExport.sha256);
      expect(repeatedExport.data).toEqual(firstExport.data);

      const preflight = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'erase_preflight',
        workspaceId,
        requestedByUserId,
        requestId: randomUUID(),
      });
      expect(preflight).toMatchObject({
        operation: 'erase_preflight',
        ready: true,
        blockers: [],
      });

      await expectAppendOnlyDeleteRejected(administrativePool, otherWorkspaceId);

      const erasure = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'erase',
        workspaceId,
        requestedByUserId,
        requestId,
        idempotencyKey,
      });
      expect(erasure.operation).toBe('erase');
      if (erasure.operation !== 'erase') {
        throw new Error('Expected a Habit erasure response');
      }
      expect(erasure.erasedRecords).toBe(2);
      expect(erasure.receiptSha256).toMatch(/^[0-9a-f]{64}$/);

      const replay = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'erase',
        workspaceId,
        requestedByUserId,
        requestId,
        idempotencyKey,
      });
      expect(replay).toEqual(erasure);

      await expect(
        runtime.dataRightsContributor.handle({
          contractVersion: 'life-os.data-rights-contributor.v1',
          operation: 'erase',
          workspaceId,
          requestedByUserId,
          requestId: randomUUID(),
          idempotencyKey,
        }),
      ).rejects.toBeInstanceOf(HabitDataRightsError);

      const verification = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'verify_erased',
        workspaceId,
        requestedByUserId,
        requestId: randomUUID(),
      });
      expect(verification).toMatchObject({
        operation: 'verify_erased',
        erased: true,
      });

      const privateExport = await runtime.dataRightsContributor.handle({
        contractVersion: 'life-os.data-rights-contributor.v1',
        operation: 'export',
        workspaceId: otherWorkspaceId,
        requestedByUserId,
        requestId: randomUUID(),
      });
      expect(privateExport.operation).toBe('export');
      if (privateExport.operation !== 'export') {
        throw new Error('Expected the preserved tenant export response');
      }
      expect(privateExport.recordCount).toBe(2);
      expect(JSON.stringify(privateExport.data)).toContain(privateHabit.id);
      expect(JSON.stringify(privateExport.data)).toContain(privateCompletion.id);

      await expectAppendOnlyDeleteRejected(administrativePool, otherWorkspaceId);
    } finally {
      await runtime.close();
    }
  });
});
