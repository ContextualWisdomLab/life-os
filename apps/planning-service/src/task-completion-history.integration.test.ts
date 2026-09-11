import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PostgresTaskCompletionRepository,
  type TaskCompletionSqlClient,
} from './task-completion';

const DATABASE_URL = process.env.PLANNING_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const CONCURRENT_TASK_ID = '55555555-5555-4555-8555-555555555555';
const CASCADE_TASK_ID = '66666666-6666-4666-8666-666666666666';
const SCOPED_TASK_ID = '77777777-7777-4777-8777-777777777777';
const CREATED_AT = '2026-09-10T15:00:00.000Z';
const FIRST_COMPLETED_AT = '2026-09-10T16:00:00.000Z';
const RETRIED_AT = '2026-09-10T17:00:00.000Z';
const RECOMPLETED_AT = '2026-09-10T18:00:00.000Z';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const migrationPath = resolve(
  __dirname,
  '../migrations/0007_task_completion_facts.sql',
);
let pool: Pool;

/** Rewrites all Planning-owned qualifiers into the isolated PostgreSQL test schema. */
function isolatedSql(text: string): string {
  return text.replaceAll('planning.', 'planning_task_completion_history_test.');
}

/** Executes the production repository statement against an isolated PostgreSQL schema. */
function createSqlClient(): TaskCompletionSqlClient {
  return {
    async query<Row>(text: string, values: readonly unknown[]) {
      const result = await pool.query(isolatedSql(text), [...values]);
      return { rows: result.rows as Row[] };
    },
  };
}

/** Inserts one valid task into the isolated Planning-owned persistence boundary. */
async function insertTask(taskId: string): Promise<void> {
  await pool.query(
    `INSERT INTO planning_task_completion_history_test.tasks
       (id, workspace_id, status, created_at, completed_at)
     VALUES ($1, $2, 'todo', $3::timestamptz, NULL)`,
    [taskId, WORKSPACE_ID, CREATED_AT],
  );
}

describeWithPostgres('Planning durable task completion facts', () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error(
        'PLANNING_DATABASE_URL is required for integration tests',
      );
    }
    pool = new Pool({
      connectionString: DATABASE_URL,
      application_name: 'life-os-planning-completion-history-test',
      max: 4,
    });
    await pool.query(
      'DROP SCHEMA IF EXISTS planning_task_completion_history_test CASCADE',
    );
    await pool.query('CREATE SCHEMA planning_task_completion_history_test');
    await pool.query(
      `CREATE TABLE planning_task_completion_history_test.tasks (
         id uuid PRIMARY KEY,
         workspace_id uuid NOT NULL,
         status text NOT NULL CHECK (status IN ('todo', 'done')),
         created_at timestamptz NOT NULL,
         completed_at timestamptz,
         CONSTRAINT task_history_test_id_workspace_unique UNIQUE (id, workspace_id),
         CONSTRAINT task_history_test_completion_state_check CHECK (
           (status = 'todo' AND completed_at IS NULL)
           OR (status = 'done' AND completed_at IS NOT NULL AND completed_at >= created_at)
         )
       )`,
    );
    const migration = await readFile(migrationPath, 'utf8');
    await pool.query(isolatedSql(migration));
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(
      'DROP SCHEMA IF EXISTS planning_task_completion_history_test CASCADE',
    );
    await pool.end();
  });

  it('declares tenant-owned completion facts with opaque identities and a period-read index', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE planning.task_completion_facts');
    expect(migration).toContain('completion_fact_id uuid PRIMARY KEY');
    expect(migration).toContain('task_completion_facts_id_uuid_v4');
    expect(migration).toContain('workspace_id uuid NOT NULL');
    expect(migration).toContain('task_id uuid NOT NULL');
    expect(migration).toContain('completed_at timestamptz NOT NULL');
    expect(migration).toContain('REFERENCES planning.tasks (id, workspace_id)');
    expect(migration).toContain(
      'task_completion_facts_workspace_completed_idx',
    );
  });

  it('enforces UUIDv4 fact identity and cascades facts when the owning task is erased', async () => {
    await insertTask(CASCADE_TASK_ID);
    await expect(
      pool.query(
        `INSERT INTO planning_task_completion_history_test.task_completion_facts
           (completion_fact_id, workspace_id, task_id, completed_at)
         VALUES ('11111111-1111-1111-8111-111111111111', $1, $2, $3::timestamptz)`,
        [WORKSPACE_ID, CASCADE_TASK_ID, FIRST_COMPLETED_AT],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'task_completion_facts_id_uuid_v4',
    });

    const repository = new PostgresTaskCompletionRepository(createSqlClient());
    await repository.transitionTaskCompletion(WORKSPACE_ID, CASCADE_TASK_ID, {
      status: 'done',
      completedAt: FIRST_COMPLETED_AT,
    });
    const factsBeforeErase = await pool.query<{ completion_fact_id: string }>(
      `SELECT completion_fact_id::text AS completion_fact_id
       FROM planning_task_completion_history_test.task_completion_facts
       WHERE workspace_id = $1 AND task_id = $2`,
      [WORKSPACE_ID, CASCADE_TASK_ID],
    );
    expect(factsBeforeErase.rows).toHaveLength(1);
    expect(factsBeforeErase.rows[0]?.completion_fact_id).toMatch(
      UUID_V4_PATTERN,
    );

    await pool.query(
      `DELETE FROM planning_task_completion_history_test.tasks
       WHERE workspace_id = $1 AND id = $2`,
      [WORKSPACE_ID, CASCADE_TASK_ID],
    );
    const factsAfterErase = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM planning_task_completion_history_test.task_completion_facts
       WHERE workspace_id = $1 AND task_id = $2`,
      [WORKSPACE_ID, CASCADE_TASK_ID],
    );
    expect(factsAfterErase.rows).toEqual([{ count: '0' }]);
  });

  it('retains each real todo-to-done fact across retries and later reopen', async () => {
    await insertTask(TASK_ID);
    const repository = new PostgresTaskCompletionRepository(createSqlClient());

    await repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
      status: 'done',
      completedAt: FIRST_COMPLETED_AT,
    });
    await repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
      status: 'done',
      completedAt: RETRIED_AT,
    });
    await repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
      status: 'todo',
      completedAt: null,
    });
    await repository.transitionTaskCompletion(WORKSPACE_ID, TASK_ID, {
      status: 'done',
      completedAt: RECOMPLETED_AT,
    });

    const facts = await pool.query<{
      workspace_id: string;
      task_id: string;
      completed_at: Date;
    }>(
      `SELECT workspace_id, task_id, completed_at
       FROM planning_task_completion_history_test.task_completion_facts
       WHERE workspace_id = $1 AND task_id = $2
       ORDER BY completion_sequence`,
      [WORKSPACE_ID, TASK_ID],
    );
    expect(
      facts.rows.map((row) => ({
        workspaceId: row.workspace_id,
        taskId: row.task_id,
        completedAt: row.completed_at.toISOString(),
      })),
    ).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        completedAt: FIRST_COMPLETED_AT,
      },
      {
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        completedAt: RECOMPLETED_AT,
      },
    ]);
  });

  it('serializes concurrent completion retries into one first-completion fact', async () => {
    await insertTask(CONCURRENT_TASK_ID);
    const repository = new PostgresTaskCompletionRepository(createSqlClient());

    const outcomes = await Promise.all([
      repository.transitionTaskCompletion(WORKSPACE_ID, CONCURRENT_TASK_ID, {
        status: 'done',
        completedAt: FIRST_COMPLETED_AT,
      }),
      repository.transitionTaskCompletion(WORKSPACE_ID, CONCURRENT_TASK_ID, {
        status: 'done',
        completedAt: RETRIED_AT,
      }),
    ]);
    expect(outcomes.every((outcome) => outcome?.status === 'done')).toBe(true);

    const facts = await pool.query<{ completed_at: Date }>(
      `SELECT completed_at
       FROM planning_task_completion_history_test.task_completion_facts
       WHERE workspace_id = $1 AND task_id = $2
       ORDER BY completion_sequence`,
      [WORKSPACE_ID, CONCURRENT_TASK_ID],
    );
    expect(facts.rows).toHaveLength(1);
    expect([FIRST_COMPLETED_AT, RETRIED_AT]).toContain(
      facts.rows[0]?.completed_at.toISOString(),
    );
    expect(outcomes[0]?.completedAt).toBe(outcomes[1]?.completedAt);
  });

  it('does not create completion facts for a task outside the workspace scope', async () => {
    await insertTask(SCOPED_TASK_ID);
    const repository = new PostgresTaskCompletionRepository(createSqlClient());

    await expect(
      repository.transitionTaskCompletion(OTHER_WORKSPACE_ID, SCOPED_TASK_ID, {
        status: 'done',
        completedAt: RECOMPLETED_AT,
      }),
    ).resolves.toBeUndefined();
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM planning_task_completion_history_test.task_completion_facts
       WHERE workspace_id = $1`,
      [OTHER_WORKSPACE_ID],
    );
    expect(count.rows).toEqual([{ count: '0' }]);
    const untouchedTask = await pool.query<{
      status: string;
      completed_at: Date | null;
    }>(
      `SELECT status, completed_at
       FROM planning_task_completion_history_test.tasks
       WHERE workspace_id = $1 AND id = $2`,
      [WORKSPACE_ID, SCOPED_TASK_ID],
    );
    expect(untouchedTask.rows).toEqual([
      { status: 'todo', completed_at: null },
    ]);
  });
});
