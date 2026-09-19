import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Habit } from './habit-domain';
import { generateHabitOccurrences } from './habit-domain';
import type {
  HabitSqlClient,
  HabitSqlQueryResult,
} from './postgres-habit-repository';
import { PostgresHabitRepository } from './postgres-habit-repository';

const DATABASE_URL = process.env.HABIT_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe.sequential : describe.skip;
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

async function applyHabitMigrations(pool: Pool): Promise<void> {
  const migrationRoot = resolve(__dirname, '../migrations');
  const migrationNames = (await readdir(migrationRoot))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();

  for (const migrationName of migrationNames) {
    const sql = await readFile(resolve(migrationRoot, migrationName), 'utf8');
    await pool.query(sql);
  }
}

function repository(pool: Pool): PostgresHabitRepository {
  return new PostgresHabitRepository(new PoolSqlClient(pool));
}

function initialHabit(workspaceId: string, habitId: string): Habit {
  return {
    id: habitId,
    workspaceId,
    title: 'Daily walk',
    timezone: 'Asia/Seoul',
    startsOn: '2026-09-01',
    recurrence: { kind: 'daily', interval: 1 },
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

describeWithPostgres('Habit definition historical authority', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-definition-history-test',
      max: 2,
    });
  });

  beforeEach(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await applyHabitMigrations(administrativePool);
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS habit CASCADE');
    await administrativePool.end();
  });

  it(
    'keeps a historical Review denominator while current reads use the revised definition',
    async () => {
      const workspaceId = randomUUID();
      const habitId = randomUUID();
      const durableRepository = repository(administrativePool);
      await durableRepository.saveHabit(initialHabit(workspaceId, habitId));

      await administrativePool.query(
        `UPDATE habit.habit_definitions
         SET title = $1,
             recurrence_kind = 'weekly',
             recurrence_interval = 1,
             weekday_mask = 1
         WHERE workspace_id = $2 AND id = $3`,
        ['Weekly walk', workspaceId, habitId],
      );

      const historicalEvidence = await durableRepository.readReviewWeekEvidence(
        workspaceId,
        '2026-09-07',
        '2026-09-13',
        100,
        '2026-09-13T23:59:59.000Z',
      );

      expect(historicalEvidence.habits).toHaveLength(1);
      expect(historicalEvidence.habits[0]?.title).toBe('Daily walk');
      expect(historicalEvidence.habits[0]?.recurrence).toEqual({
        kind: 'daily',
        interval: 1,
      });
      expect(
        generateHabitOccurrences(
          historicalEvidence.habits[0]!,
          '2026-09-07',
          '2026-09-13',
        ),
      ).toHaveLength(7);

      const currentEvidence = await durableRepository.readReviewWeekEvidence(
        workspaceId,
        '2026-09-07',
        '2026-09-13',
        100,
        '9999-12-31T23:59:59.000Z',
      );

      expect(currentEvidence.habits).toHaveLength(1);
      expect(currentEvidence.habits[0]?.title).toBe('Weekly walk');
      expect(currentEvidence.habits[0]?.recurrence).toEqual({
        kind: 'weekly',
        interval: 1,
        weekdays: [1],
      });
      expect(
        generateHabitOccurrences(
          currentEvidence.habits[0]!,
          '2026-09-07',
          '2026-09-13',
        ),
      ).toHaveLength(1);
    },
  );

  it(
    'does not manufacture history for no-op updates and rejects identity evidence rewrites',
    async () => {
      const workspaceId = randomUUID();
      const habitId = randomUUID();
      const durableRepository = repository(administrativePool);
      await durableRepository.saveHabit(initialHabit(workspaceId, habitId));

      await administrativePool.query(
        `UPDATE habit.habit_definitions
       SET title = title
       WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, habitId],
      );

      const historyAfterNoop = await administrativePool.query<{ count: string }>(
        `SELECT count(*)::text AS count
       FROM habit.habit_definition_history
       WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, habitId],
      );
      expect(historyAfterNoop.rows[0]?.count).toBe('0');

      await expect(
        administrativePool.query(
          `UPDATE habit.habit_definitions
         SET created_at = created_at + interval '1 day'
         WHERE workspace_id = $1 AND id = $2`,
          [workspaceId, habitId],
        ),
      ).rejects.toThrow(
        'Habit definition identity and creation evidence are immutable',
      );
    },
  );

  it(
    'erases superseded definition history through the existing owner-authorized path',
    async () => {
      const workspaceId = randomUUID();
      const habitId = randomUUID();
      const durableRepository = repository(administrativePool);
      await durableRepository.saveHabit(initialHabit(workspaceId, habitId));

      await administrativePool.query(
        `UPDATE habit.habit_definitions
       SET title = $1
       WHERE workspace_id = $2 AND id = $3`,
        ['Revised walk', workspaceId, habitId],
      );

      const beforeErasure = await administrativePool.query<{ count: string }>(
        `SELECT count(*)::text AS count
       FROM habit.habit_definition_history
       WHERE workspace_id = $1`,
        [workspaceId],
      );
      expect(beforeErasure.rows[0]?.count).toBe('1');

      const erasure = await administrativePool.query<{ erased_records: number }>(
        'SELECT habit.erase_workspace_data($1::uuid) AS erased_records',
        [workspaceId],
      );
      expect(erasure.rows[0]?.erased_records).toBe(2);

      const afterErasure = await administrativePool.query<{ count: string }>(
        `SELECT count(*)::text AS count
       FROM habit.habit_definition_history
       WHERE workspace_id = $1`,
        [workspaceId],
      );
      expect(afterErasure.rows[0]?.count).toBe('0');
      expect(
        await durableRepository.findHabit(workspaceId, habitId),
      ).toBeUndefined();
    },
  );
});
