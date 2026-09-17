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
  idempotencyKey: string;
}

interface HabitDefinitionRevisionEvidence {
  schemaVersion: 'life-os.habit-definition-revision.v1';
  workspaceId: string;
  habitId: string;
  revisionNumber: number;
  effectiveFromLocalDate: string;
  recordedAt: string;
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

function requireRuleChangeAuthority(
  service: HabitService,
): HabitRuleChangeService {
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

describeWithPostgres('Habit idempotency payload binding', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-rule-change-idempotency-payload-test',
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

  it('binds a key to the canonical semantic rule change and rejects actual semantic changes', async () => {
    const workspaceId = randomUUID();
    const habitId = randomUUID();
    const durableRepository = repository(administrativePool);
    await seedDailyHabit(durableRepository, workspaceId, habitId);

    const idempotencyKey = randomUUID();
    const command: HabitDefinitionRevisionCommand = {
      effectiveFromLocalDate: '2026-09-14',
      title: ' Weekly walk ',
      timezone: ' Asia/Seoul ',
      recurrence: { kind: 'weekly', interval: 1, weekdays: [5, 1, 5] },
      idempotencyKey,
    };
    const firstService = requireRuleChangeAuthority(
      new HabitService(durableRepository, () => '2026-09-14T00:00:00.000Z'),
    );
    const accepted = await firstService.reviseHabitDefinition(
      workspaceId,
      habitId,
      command,
    );
    expect(accepted).toMatchObject({
      schemaVersion: 'life-os.habit-definition-revision.v1',
      workspaceId,
      habitId,
      revisionNumber: 2,
      effectiveFromLocalDate: '2026-09-14',
      recordedAt: '2026-09-14T00:00:00.000Z',
    });

    const restartedService = requireRuleChangeAuthority(
      new HabitService(
        repository(administrativePool),
        () => '2026-09-14T01:00:00.000Z',
      ),
    );
    const canonicalEquivalentReplay: HabitDefinitionRevisionCommand = {
      ...command,
      title: 'Weekly walk',
      timezone: 'Asia/Seoul',
      recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 5] },
    };
    await expect(
      restartedService.reviseHabitDefinition(
        workspaceId,
        habitId,
        canonicalEquivalentReplay,
      ),
    ).resolves.toEqual(accepted);

    const conflicts: HabitDefinitionRevisionCommand[] = [
      { ...canonicalEquivalentReplay, title: 'Conflicting title' },
      { ...canonicalEquivalentReplay, timezone: 'Etc/UTC' },
      {
        ...canonicalEquivalentReplay,
        recurrence: { kind: 'weekly', interval: 1, weekdays: [5] },
      },
    ];

    for (const conflict of conflicts) {
      await expect(
        restartedService.reviseHabitDefinition(workspaceId, habitId, conflict),
      ).rejects.toThrow();
    }

    const nextRevision = await restartedService.reviseHabitDefinition(
      workspaceId,
      habitId,
      {
        effectiveFromLocalDate: '2026-09-15',
        title: 'Tuesday walk',
        timezone: 'Asia/Seoul',
        recurrence: { kind: 'weekly', interval: 1, weekdays: [2] },
        idempotencyKey: randomUUID(),
      },
    );
    expect(nextRevision.revisionNumber).toBe(3);
  });
});
