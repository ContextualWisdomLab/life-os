import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Habit, HabitCompletionEvent } from './habit-domain';
import {
  HabitIdempotencyConflictError,
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

async function applyMigration(pool: Pool): Promise<void> {
  const sql = await readFile(
    resolve(__dirname, '../migrations/0001_recurring_habit_core.sql'),
    'utf8',
  );
  await pool.query(sql);
}

function repository(pool: Pool): PostgresHabitRepository {
  return new PostgresHabitRepository(new PoolSqlClient(pool));
}

function habit(
  workspaceId: string,
  overrides: Partial<Habit> = {},
): Habit {
  return {
    id: randomUUID(),
    workspaceId,
    title: 'Persist recurring habit',
    timezone: 'America/New_York',
    startsOn: '2026-03-01',
    recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 5] },
    createdAt: '2026-08-04T00:00:00.000Z',
    ...overrides,
  };
}

function completion(
  storedHabit: Habit,
  idempotencyKey: string,
  overrides: Partial<HabitCompletionEvent> = {},
): HabitCompletionEvent {
  return {
    id: randomUUID(),
    workspaceId: storedHabit.workspaceId,
    habitId: storedHabit.id,
    scheduledLocalDate: '2026-03-02',
    completedAt: '2026-03-02T13:00:00.000Z',
    idempotencyKey,
    recordedAt: '2026-03-02T13:00:01.000Z',
    ...overrides,
  };
}

describeWithPostgres('PostgreSQL Habit repository integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-integration-admin',
      max: 8,
    });
  });

  beforeEach(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await applyMigration(administrativePool);
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await administrativePool.end();
  });

  it('preserves tenant-safe habits across pool restarts with stable ordering', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const first = habit(workspaceId, {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'First stable habit',
    });
    const second = habit(workspaceId, {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'Second stable habit',
    });
    const privateHabit = habit(otherWorkspaceId);
    const firstPool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-integration-first',
      max: 2,
    });
    const firstRepository = repository(firstPool);
    await firstRepository.saveHabit(second);
    await firstRepository.saveHabit(first);
    await firstRepository.saveHabit(privateHabit);
    await firstPool.end();

    const restartedPool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-integration-restarted',
      max: 2,
    });
    const restartedRepository = repository(restartedPool);
    await expect(restartedRepository.listHabits(workspaceId)).resolves.toEqual([
      first,
      second,
    ]);
    await expect(
      restartedRepository.findHabit(workspaceId, privateHabit.id),
    ).resolves.toBeUndefined();
    await restartedPool.end();
  });

  it('serializes concurrent duplicate completion commands into one event', async () => {
    const workspaceId = randomUUID();
    const storedHabit = habit(workspaceId);
    const idempotencyKey = randomUUID();
    const durableRepository = repository(administrativePool);
    await durableRepository.saveHabit(storedHabit);

    const attempts = Array.from({ length: 12 }, (_, index) =>
      durableRepository.appendCompletion(
        completion(storedHabit, idempotencyKey, {
          recordedAt: new Date(
            Date.parse('2026-03-02T13:00:01.000Z') + index,
          ).toISOString(),
        }),
      ),
    );
    const results = await Promise.all(attempts);
    const history = await durableRepository.listCompletions(
      workspaceId,
      storedHabit.id,
    );

    expect(history).toHaveLength(1);
    expect(results.every((result) => result.id === history[0]?.id)).toBe(true);
    expect(results.every((result) => result.completedAt === history[0]?.completedAt)).toBe(
      true,
    );
  });

  it('rejects a conflicting idempotency replay without adding history', async () => {
    const workspaceId = randomUUID();
    const storedHabit = habit(workspaceId);
    const idempotencyKey = randomUUID();
    const durableRepository = repository(administrativePool);
    await durableRepository.saveHabit(storedHabit);
    await durableRepository.appendCompletion(
      completion(storedHabit, idempotencyKey),
    );

    await expect(
      durableRepository.appendCompletion(
        completion(storedHabit, idempotencyKey, {
          completedAt: '2026-03-02T14:00:00.000Z',
        }),
      ),
    ).rejects.toBeInstanceOf(HabitIdempotencyConflictError);
    await expect(
      durableRepository.listCompletions(workspaceId, storedHabit.id),
    ).resolves.toHaveLength(1);
  });

  it('enforces append-only completion history for update, delete, and truncate', async () => {
    const workspaceId = randomUUID();
    const storedHabit = habit(workspaceId);
    const durableRepository = repository(administrativePool);
    await durableRepository.saveHabit(storedHabit);
    const event = await durableRepository.appendCompletion(
      completion(storedHabit, randomUUID()),
    );

    await expect(
      administrativePool.query(
        'UPDATE habit.completion_events SET completed_at = $1 WHERE id = $2',
        ['2026-03-02T14:00:00.000Z', event.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      administrativePool.query(
        'DELETE FROM habit.completion_events WHERE id = $1',
        [event.id],
      ),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      administrativePool.query('TRUNCATE habit.completion_events'),
    ).rejects.toMatchObject({ code: '55000' });
    await expect(
      durableRepository.listCompletions(workspaceId, storedHabit.id),
    ).resolves.toEqual([event]);
  });
});
