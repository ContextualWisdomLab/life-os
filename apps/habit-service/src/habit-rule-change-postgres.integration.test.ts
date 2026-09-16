import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Habit, HabitRecurrence } from './habit-domain';
import { HabitService } from './habit-domain';
import type {
  HabitSqlClient,
  HabitSqlQueryResult,
} from './postgres-habit-repository';
import { PostgresHabitRepository } from './postgres-habit-repository';

const DATABASE_URL = process.env.HABIT_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe.sequential : describe.skip;
let administrativePool: Pool;

interface HabitDefinitionRevisionCommand {
  effectiveFromLocalDate: string;
  title: string;
  timezone: string;
  recurrence: HabitRecurrence;
}

interface HabitDefinitionRevisionEvidence {
  schemaVersion: 'life-os.habit-definition-revision.v1';
  workspaceId: string;
  habitId: string;
  revisionNumber: number;
  effectiveFromLocalDate: string;
}

type HabitRuleChangeService = HabitService & {
  reviseHabitDefinition(
    workspaceId: string,
    habitId: string,
    command: HabitDefinitionRevisionCommand,
  ): Promise<HabitDefinitionRevisionEvidence>;
};

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

function requireRuleChangeAuthority(service: HabitService): HabitRuleChangeService {
  const candidate = Reflect.get(service, 'reviseHabitDefinition');
  expect(
    candidate,
    'Habit must own an explicit effective-dated definition revision command',
  ).toBeTypeOf('function');
  return service as HabitRuleChangeService;
}

async function seedDailyHabit(
  durableRepository: PostgresHabitRepository,
  workspaceId: string,
  habitId: string,
): Promise<void> {
  const initialHabit: Habit = {
    id: habitId,
    workspaceId,
    title: 'Daily walk',
    timezone: 'Asia/Seoul',
    startsOn: '2026-09-01',
    recurrence: { kind: 'daily', interval: 1 },
    createdAt: '2026-09-01T00:00:00.000Z',
  };
  await durableRepository.saveHabit(initialHabit);
}

describeWithPostgres('Habit effective-dated rule change authority', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-rule-change-test',
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

  it('keeps a completed Review week on the definition that was effective during that period', async () => {
    const workspaceId = randomUUID();
    const habitId = randomUUID();
    const durableRepository = repository(administrativePool);
    await seedDailyHabit(durableRepository, workspaceId, habitId);

    const service = new HabitService(
      durableRepository,
      () => '2026-09-20T00:00:00.000Z',
    );
    const ruleChangeService = requireRuleChangeAuthority(service);

    const revision = await ruleChangeService.reviseHabitDefinition(
      workspaceId,
      habitId,
      {
        effectiveFromLocalDate: '2026-09-14',
        title: 'Weekly walk',
        timezone: 'Asia/Seoul',
        recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
      },
    );

    expect(revision).toMatchObject({
      schemaVersion: 'life-os.habit-definition-revision.v1',
      workspaceId,
      habitId,
      revisionNumber: 2,
      effectiveFromLocalDate: '2026-09-14',
    });

    const historical = await service.projectReviewWeek(
      workspaceId,
      '2026-09-07',
    );
    expect(historical.scheduledOpportunityCount).toBe(7);
    expect(historical.habits).toHaveLength(1);
    expect(historical.habits[0]).toMatchObject({
      habitId,
      title: 'Daily walk',
      scheduledOpportunityCount: 7,
    });
  });

  it('changes scheduled opportunities only on and after an in-period effective boundary', async () => {
    const workspaceId = randomUUID();
    const habitId = randomUUID();
    const durableRepository = repository(administrativePool);
    await seedDailyHabit(durableRepository, workspaceId, habitId);

    const service = new HabitService(
      durableRepository,
      () => '2026-09-13T23:59:59.000Z',
    );
    const ruleChangeService = requireRuleChangeAuthority(service);

    await ruleChangeService.reviseHabitDefinition(workspaceId, habitId, {
      effectiveFromLocalDate: '2026-09-10',
      title: 'Daily walk',
      timezone: 'Asia/Seoul',
      recurrence: { kind: 'weekly', interval: 1, weekdays: [5] },
    });

    const projection = await service.projectReviewWeek(
      workspaceId,
      '2026-09-07',
    );

    // Mon-Wed retain the prior daily rule; the new rule contributes Friday only.
    expect(projection.scheduledOpportunityCount).toBe(4);
    expect(projection.habits).toHaveLength(1);
    expect(projection.habits[0]).toMatchObject({
      habitId,
      scheduledOpportunityCount: 4,
    });
  });
});
