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

describeWithPostgres('Habit durable rule-change idempotency authority', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-habit-rule-change-idempotency-test',
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

  it('replays accepted evidence after service and repository reconstruction', async () => {
    const workspaceId = randomUUID();
    const habitId = randomUUID();
    const initialRepository = repository(administrativePool);
    await seedDailyHabit(initialRepository, workspaceId, habitId);

    const idempotencyKey = randomUUID();
    const command: HabitDefinitionRevisionCommand = {
      effectiveFromLocalDate: '2026-09-14',
      title: 'Weekly walk',
      timezone: 'Asia/Seoul',
      recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
      idempotencyKey,
    };
    const firstMutationService = new HabitService(
      initialRepository,
      () => '2026-09-14T00:00:00.000Z',
    );
    const firstService = requireRuleChangeAuthority(firstMutationService);
    const first = await firstService.reviseHabitDefinition(
      workspaceId,
      habitId,
      command,
    );
    expect(first).toMatchObject({
      schemaVersion: 'life-os.habit-definition-revision.v1',
      workspaceId,
      habitId,
      revisionNumber: 2,
      effectiveFromLocalDate: '2026-09-14',
      recordedAt: '2026-09-14T00:00:00.000Z',
    });

    const restartedRepository = repository(administrativePool);
    const restartedMutationService = new HabitService(
      restartedRepository,
      () => '2026-09-15T00:00:00.000Z',
    );
    const restartedService = requireRuleChangeAuthority(
      restartedMutationService,
    );

    const replay = await restartedService.reviseHabitDefinition(
      workspaceId,
      habitId,
      command,
    );
    expect(replay).toEqual(first);

    await expect(
      restartedService.reviseHabitDefinition(workspaceId, habitId, {
        ...command,
        effectiveFromLocalDate: '2026-09-15',
        title: 'Conflicting retry',
        idempotencyKey,
      }),
    ).rejects.toThrow();
  });

  it('converges concurrent same-key requests from independent service instances on one durable revision', async () => {
    const workspaceId = randomUUID();
    const habitId = randomUUID();
    const seedRepository = repository(administrativePool);
    await seedDailyHabit(seedRepository, workspaceId, habitId);

    const command: HabitDefinitionRevisionCommand = {
      effectiveFromLocalDate: '2026-09-14',
      title: 'Weekly walk',
      timezone: 'Asia/Seoul',
      recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
      idempotencyKey: randomUUID(),
    };
    const firstService = requireRuleChangeAuthority(
      new HabitService(
        repository(administrativePool),
        () => '2026-09-14T00:00:00.000Z',
      ),
    );
    const secondService = requireRuleChangeAuthority(
      new HabitService(
        repository(administrativePool),
        () => '2026-09-14T00:00:00.000Z',
      ),
    );

    const [first, second] = await Promise.all([
      firstService.reviseHabitDefinition(workspaceId, habitId, command),
      secondService.reviseHabitDefinition(workspaceId, habitId, command),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 'life-os.habit-definition-revision.v1',
      workspaceId,
      habitId,
      revisionNumber: 2,
      effectiveFromLocalDate: '2026-09-14',
      recordedAt: '2026-09-14T00:00:00.000Z',
    });

    const nextService = requireRuleChangeAuthority(
      new HabitService(
        repository(administrativePool),
        () => '2026-09-15T00:00:00.000Z',
      ),
    );
    const nextRevision = await nextService.reviseHabitDefinition(
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

  it('allows exactly one concurrent command to claim an effective boundary', async () => {
    const workspaceId = randomUUID();
    const habitId = randomUUID();
    const seedRepository = repository(administrativePool);
    await seedDailyHabit(seedRepository, workspaceId, habitId);

    const firstService = requireRuleChangeAuthority(
      new HabitService(
        repository(administrativePool),
        () => '2026-09-14T00:00:00.000Z',
      ),
    );
    const secondService = requireRuleChangeAuthority(
      new HabitService(
        repository(administrativePool),
        () => '2026-09-14T00:00:00.000Z',
      ),
    );
    const firstCommand: HabitDefinitionRevisionCommand = {
      effectiveFromLocalDate: '2026-09-14',
      title: 'Monday walk',
      timezone: 'Asia/Seoul',
      recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
      idempotencyKey: randomUUID(),
    };
    const secondCommand: HabitDefinitionRevisionCommand = {
      effectiveFromLocalDate: '2026-09-14',
      title: 'Friday walk',
      timezone: 'Asia/Seoul',
      recurrence: { kind: 'weekly', interval: 1, weekdays: [5] },
      idempotencyKey: randomUUID(),
    };

    const results = await Promise.allSettled([
      firstService.reviseHabitDefinition(workspaceId, habitId, firstCommand),
      secondService.reviseHabitDefinition(workspaceId, habitId, secondCommand),
    ]);
    const accepted = results.filter(
      (
        result,
      ): result is PromiseFulfilledResult<HabitDefinitionRevisionEvidence> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(accepted[0]?.value).toMatchObject({
      schemaVersion: 'life-os.habit-definition-revision.v1',
      workspaceId,
      habitId,
      revisionNumber: 2,
      effectiveFromLocalDate: '2026-09-14',
      recordedAt: '2026-09-14T00:00:00.000Z',
    });

    const nextService = requireRuleChangeAuthority(
      new HabitService(
        repository(administrativePool),
        () => '2026-09-15T00:00:00.000Z',
      ),
    );
    const nextRevision = await nextService.reviseHabitDefinition(
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
