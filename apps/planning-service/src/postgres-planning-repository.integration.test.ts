import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createPlanningRuntime,
  type PlanningRuntime,
} from './planning-runtime';
import {
  TodayIdempotencyConflictError,
  TodayRevisionConflictError,
} from './today-sync';

const DATABASE_URL = process.env.PLANNING_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const activeRuntimes: PlanningRuntime[] = [];
let administrativePool: Pool;

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('PLANNING_DATABASE_URL is required for integration tests');
  }
  return DATABASE_URL;
}

async function applyMigrations(pool: Pool): Promise<void> {
  for (const migration of [
    '0001_initial_planning.sql',
    '0002_durable_repository_contract.sql',
    '0003_durable_today_sync.sql',
  ]) {
    const sql = await readFile(
      resolve(__dirname, '../migrations', migration),
      'utf8',
    );
    await pool.query(sql);
  }
}

function createRuntime(): PlanningRuntime {
  const runtime = createPlanningRuntime({
    PLANNING_DATABASE_URL: requireDatabaseUrl(),
    PLANNING_DATABASE_POOL_MAX: '4',
    PLANNING_DATABASE_CONNECT_TIMEOUT_MS: '5000',
    PLANNING_DATABASE_IDLE_TIMEOUT_MS: '1000',
  });
  activeRuntimes.push(runtime);
  return runtime;
}

function todayDraft(date: string, title = 'Durable Today') {
  return {
    version: 'life-os.today.v1' as const,
    date,
    actions: [
      {
        id: randomUUID(),
        title,
        status: 'open' as const,
        priority: 1 as const,
        startMinute: 540,
        durationMinutes: 60,
        createdAt: '2026-08-09T00:00:00.000Z',
        completedAt: null,
      },
    ],
  };
}

describeWithPostgres('PostgreSQL Planning repository integration', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-planning-integration-admin',
      max: 2,
    });
    await administrativePool.query('DROP SCHEMA IF EXISTS planning CASCADE');
    await applyMigrations(administrativePool);
  }, 30_000);

  beforeEach(async () => {
    await administrativePool.query(
      `TRUNCATE
         planning.today_idempotency_records,
         planning.today_aggregates,
         planning.tasks,
         planning.projects,
         planning.goals`,
    );
  });

  afterEach(async () => {
    await Promise.all(
      activeRuntimes.splice(0).map((runtime) => runtime.close()),
    );
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS planning CASCADE');
    await administrativePool.end();
  }, 30_000);

  it('preserves a tenant-safe hierarchy across runtime restarts', async () => {
    const workspaceId = randomUUID();
    const firstRuntime = createRuntime();
    const goal = await firstRuntime.service.createGoal(workspaceId, {
      title: 'Ship durable planning',
    });
    const project = await firstRuntime.service.createProject(workspaceId, {
      goalId: goal.id,
      title: 'PostgreSQL runtime',
    });
    const task = await firstRuntime.service.createTask(workspaceId, {
      projectId: project.id,
      title: 'Prove restart durability',
    });
    await firstRuntime.close();

    const restartedRuntime = createRuntime();
    await expect(
      restartedRuntime.service.listGoals(workspaceId),
    ).resolves.toEqual([goal]);
    await expect(
      restartedRuntime.service.listProjects(workspaceId, goal.id),
    ).resolves.toEqual([project]);
    await expect(
      restartedRuntime.service.listTasks(workspaceId, project.id),
    ).resolves.toEqual([task]);
  });

  it('fails closed when a workspace references another tenant parent', async () => {
    const workspaceA = randomUUID();
    const workspaceB = randomUUID();
    const runtime = createRuntime();
    const privateGoal = await runtime.service.createGoal(workspaceA, {
      title: 'Workspace A goal',
    });
    await runtime.service.createGoal(workspaceB, {
      title: 'Workspace B goal',
    });

    await expect(runtime.service.listGoals(workspaceB)).resolves.toHaveLength(
      1,
    );
    await expect(
      runtime.service.createProject(workspaceB, {
        goalId: privateGoal.id,
        title: 'Cross-tenant project',
      }),
    ).rejects.toThrowError('Goal not found');
  });

  it('retains every concurrent write with stable read ordering', async () => {
    const workspaceId = randomUUID();
    const runtime = createRuntime();
    const goal = await runtime.service.createGoal(workspaceId, {
      title: 'Concurrent goal',
    });
    const project = await runtime.service.createProject(workspaceId, {
      goalId: goal.id,
      title: 'Concurrent project',
    });

    const created = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        runtime.service.createTask(workspaceId, {
          projectId: project.id,
          title: `Concurrent task ${index + 1}`,
        }),
      ),
    );
    const firstRead = await runtime.service.listTasks(workspaceId, project.id);
    const secondRead = await runtime.service.listTasks(workspaceId, project.id);
    const uniqueTaskIds = new Set(firstRead.map((task) => task.id));

    expect(firstRead).toEqual(secondRead);
    expect(firstRead).toHaveLength(created.length);
    expect(uniqueTaskIds.size).toBe(created.length);
    expect(new Set(firstRead.map((task) => task.title))).toEqual(
      new Set(created.map((task) => task.title)),
    );
  });

  it('normalizes, ranks, bounds, and tenant-scopes unified search in PostgreSQL', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const runtime = createRuntime();
    const goal = await runtime.service.createGoal(workspaceId, {
      title: 'ＬＡＵＮＣＨ　ＰＬＡＮ',
    });
    const project = await runtime.service.createProject(workspaceId, {
      goalId: goal.id,
      title: 'Launch plan execution',
    });
    const task = await runtime.service.createTask(workspaceId, {
      projectId: project.id,
      title: 'Draft launch plan evidence',
    });
    await runtime.service.createGoal(workspaceId, {
      title: 'Launch planning',
    });
    await runtime.service.createGoal(otherWorkspaceId, {
      title: 'Launch plan',
    });

    await expect(
      runtime.service.search(workspaceId, 'launch plan'),
    ).resolves.toEqual([
      {
        entityType: 'goal',
        id: goal.id,
        title: goal.title,
        createdAt: goal.createdAt,
      },
      {
        entityType: 'project',
        id: project.id,
        parentId: goal.id,
        title: project.title,
        createdAt: project.createdAt,
      },
      {
        entityType: 'task',
        id: task.id,
        parentId: project.id,
        title: task.title,
        status: task.status,
        createdAt: task.createdAt,
      },
    ]);
    await expect(
      runtime.service.search(workspaceId, 'launch plan', 2),
    ).resolves.toEqual([
      {
        entityType: 'goal',
        id: goal.id,
        title: goal.title,
        createdAt: goal.createdAt,
      },
      {
        entityType: 'project',
        id: project.id,
        parentId: goal.id,
        title: project.title,
        createdAt: project.createdAt,
      },
    ]);
    await expect(
      runtime.service.search(otherWorkspaceId, 'evidence'),
    ).resolves.toEqual([]);
  });

  it('persists Today across restarts while isolating workspaces', async () => {
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const date = '2026-08-09';
    const firstRuntime = createRuntime();
    const draft = todayDraft(date);
    const created = await firstRuntime.todayService.putToday(
      workspaceId,
      draft,
      { kind: 'absent' },
      randomUUID(),
    );
    await firstRuntime.close();

    const restartedRuntime = createRuntime();
    await expect(
      restartedRuntime.todayService.getToday(workspaceId, date),
    ).resolves.toEqual(created.aggregate);
    await expect(
      restartedRuntime.todayService.getToday(otherWorkspaceId, date),
    ).resolves.toBeUndefined();
  });

  it('serializes concurrent Today updates so only the exact current revision wins', async () => {
    const workspaceId = randomUUID();
    const date = '2026-08-09';
    const runtime = createRuntime();
    const created = await runtime.todayService.putToday(
      workspaceId,
      todayDraft(date),
      { kind: 'absent' },
      randomUUID(),
    );

    const outcomes = await Promise.allSettled([
      runtime.todayService.putToday(
        workspaceId,
        todayDraft(date, 'Device A edit'),
        { kind: 'match', revision: created.aggregate.revision },
        randomUUID(),
      ),
      runtime.todayService.putToday(
        workspaceId,
        todayDraft(date, 'Device B edit'),
        { kind: 'match', revision: created.aggregate.revision },
        randomUUID(),
      ),
    ]);
    const fulfilled = outcomes.filter(
      (outcome) => outcome.status === 'fulfilled',
    );
    const rejected = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      TodayRevisionConflictError,
    );
    const current = await runtime.todayService.getToday(workspaceId, date);
    expect(current?.revision).toBe(
      (fulfilled[0] as PromiseFulfilledResult<{ aggregate: { revision: string } }>).value
        .aggregate.revision,
    );
  });

  it('replays the original Today response after later revisions and rejects key reuse', async () => {
    const workspaceId = randomUUID();
    const date = '2026-08-09';
    const runtime = createRuntime();
    const createKey = randomUUID();
    const originalDraft = todayDraft(date, 'Original Today');
    const created = await runtime.todayService.putToday(
      workspaceId,
      originalDraft,
      { kind: 'absent' },
      createKey,
    );
    await runtime.todayService.putToday(
      workspaceId,
      todayDraft(date, 'Newer Today'),
      { kind: 'match', revision: created.aggregate.revision },
      randomUUID(),
    );

    const replay = await runtime.todayService.putToday(
      workspaceId,
      originalDraft,
      { kind: 'absent' },
      createKey,
    );
    expect(replay.kind).toBe('replayed');
    expect(replay.aggregate).toEqual(created.aggregate);
    await expect(
      runtime.todayService.putToday(
        workspaceId,
        todayDraft(date, 'Conflicting reuse'),
        { kind: 'absent' },
        createKey,
      ),
    ).rejects.toBeInstanceOf(TodayIdempotencyConflictError);
  });
});
