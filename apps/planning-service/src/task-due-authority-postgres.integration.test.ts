import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
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
import type { Task } from './planning-domain';
import {
  createPlanningRuntime,
  type PlanningRuntime,
} from './planning-runtime';

const DATABASE_URL = process.env.PLANNING_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe.sequential : describe.skip;
const activeRuntimes: PlanningRuntime[] = [];
let administrativePool: Pool;

interface TaskWithDueAuthority extends Task {
  dueAt: string | null;
}

type DueAwareCreateTask = (
  workspaceId: string,
  input: { projectId: string; title: string; dueAt?: string | null },
) => Promise<TaskWithDueAuthority>;

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('PLANNING_DATABASE_URL is required for integration tests');
  }
  return DATABASE_URL;
}

async function applyPlanningMigrations(pool: Pool): Promise<void> {
  const migrationRoot = resolve(__dirname, '../migrations');
  const migrationNames = (await readdir(migrationRoot))
    .filter((name) => /^\d{4}_.+\.sql$/u.test(name))
    .sort();

  for (const migrationName of migrationNames) {
    const sql = await readFile(resolve(migrationRoot, migrationName), 'utf8');
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

function createTaskWithDueAuthority(
  runtime: PlanningRuntime,
  workspaceId: string,
  input: { projectId: string; title: string; dueAt?: string | null },
): Promise<TaskWithDueAuthority> {
  const createTask = runtime.service.createTask.bind(
    runtime.service,
  ) as unknown as DueAwareCreateTask;
  return createTask(workspaceId, input);
}

async function seedProject(runtime: PlanningRuntime, workspaceId: string) {
  const goal = await runtime.service.createGoal(workspaceId, {
    title: 'Weekly review evidence',
  });
  return await runtime.service.createProject(workspaceId, {
    goalId: goal.id,
    title: 'Planning chronology',
  });
}

describeWithPostgres('Planning task due authority', () => {
  beforeAll(async () => {
    administrativePool = new Pool({
      connectionString: requireDatabaseUrl(),
      application_name: 'life-os-planning-task-due-authority-test',
      max: 2,
    });
  });

  beforeEach(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS planning CASCADE');
    await applyPlanningMigrations(administrativePool);
  });

  afterEach(async () => {
    await Promise.all(
      activeRuntimes.splice(0).map((runtime) => runtime.close()),
    );
  });

  afterAll(async () => {
    await administrativePool.query('DROP SCHEMA IF EXISTS planning CASCADE');
    await administrativePool.end();
  });

  it('persists an explicit UTC due instant across a runtime restart', async () => {
    const workspaceId = randomUUID();
    const firstRuntime = createRuntime();
    const project = await seedProject(firstRuntime, workspaceId);
    const dueAt = '2026-09-18T09:00:00.123Z';

    const created = await createTaskWithDueAuthority(
      firstRuntime,
      workspaceId,
      {
        projectId: project.id,
        title: 'Submit release evidence',
        dueAt,
      },
    );
    expect(created.dueAt).toBe(dueAt);
    await firstRuntime.close();

    const restartedRuntime = createRuntime();
    const tasks = (await restartedRuntime.service.listTasks(
      workspaceId,
      project.id,
    )) as TaskWithDueAuthority[];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: created.id,
      dueAt,
    });
  });

  it('treats omitted and explicit null deadlines as the same durable no-deadline authority', async () => {
    const workspaceId = randomUUID();
    const runtime = createRuntime();
    const project = await seedProject(runtime, workspaceId);

    const omitted = await createTaskWithDueAuthority(runtime, workspaceId, {
      projectId: project.id,
      title: 'Undated backlog item',
    });
    const explicitNull = await createTaskWithDueAuthority(
      runtime,
      workspaceId,
      {
        projectId: project.id,
        title: 'Explicitly undated backlog item',
        dueAt: null,
      },
    );

    expect(omitted).toHaveProperty('dueAt', null);
    expect(explicitNull).toHaveProperty('dueAt', null);

    const tasks = (await runtime.service.listTasks(
      workspaceId,
      project.id,
    )) as TaskWithDueAuthority[];
    expect(tasks).toHaveLength(2);
    expect(tasks.find((task) => task.id === omitted.id)).toHaveProperty(
      'dueAt',
      null,
    );
    expect(tasks.find((task) => task.id === explicitNull.id)).toHaveProperty(
      'dueAt',
      null,
    );
  });

  it('rejects noncanonical due input instead of silently recanonicalizing deadline meaning', async () => {
    const workspaceId = randomUUID();
    const runtime = createRuntime();
    const project = await seedProject(runtime, workspaceId);
    const noncanonicalDueInstants = [
      '2026-09-18T18:00:00.123+09:00',
      '2026-09-18T09:00:00Z',
      '2026-09-18T09:00:00.123+00:00',
      '2026-09-18T09:00:00.1230Z',
    ];

    for (const dueAt of noncanonicalDueInstants) {
      await expect(
        createTaskWithDueAuthority(runtime, workspaceId, {
          projectId: project.id,
          title: 'Ambiguous deadline',
          dueAt,
        }),
      ).rejects.toThrow();
    }
  });
});
