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
const CREATED_AT = '2026-09-10T15:00:00.000Z';
const FIRST_COMPLETED_AT = '2026-09-10T16:00:00.000Z';
const RETRIED_AT = '2026-09-10T17:00:00.000Z';
const RECOMPLETED_AT = '2026-09-10T18:00:00.000Z';
const TEST_SCHEMA = 'planning_task_completion_history_test';
const migrationPath = resolve(
  __dirname,
  '../migrations/0007_task_completion_facts.sql',
);
let pool: Pool;

/** Rewrites only canonical Planning table qualifiers into the isolated test schema. */
function isolatedSql(text: string): string {
  return text
    .replaceAll('planning.task_completion_facts', `${TEST_SCHEMA}.task_completion_facts`)
    .replaceAll('planning.tasks', `${TEST_SCHEMA}.tasks`);
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

describeWithPostgres('Planning durable task completion facts', () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('PLANNING_DATABASE_URL is required for integration tests');
    }
    pool = new Pool({
      connectionString: DATABASE_URL,
      application_name: 'life-os-planning-completion-history-test',
      max: 2,
    });
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await pool.query(
      `CREATE TABLE ${TEST_SCHEMA}.tasks (
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
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.end();
  });

  it('declares tenant-owned immutable completion facts with a period-read index', async () => {
    const migration = await readFile(migrationPath, 'utf8');

    expect(migration).toContain('CREATE TABLE planning.task_completion_facts');
    expect(migration).toContain('workspace_id uuid NOT NULL');
    expect(migration).toContain('task_id uuid NOT NULL');
    expect(migration).toContain('completed_at timestamptz NOT NULL');
    expect(migration).toContain('REFERENCES planning.tasks (id, workspace_id)');
    expect(migration).toContain(
      'task_completion_facts_workspace_completed_idx',
    );
  });

  it('retains each real todo-to-done fact across retries and later reopen', async () => {
    await pool.query(
      `INSERT INTO ${TEST_SCHEMA}.tasks
         (id, workspace_id, status, created_at, completed_at)
       VALUES ($1, $2, 'todo', $3::timestamptz, NULL)`,
      [TASK_ID, WORKSPACE_ID, CREATED_AT],
    );
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
       FROM ${TEST_SCHEMA}.task_completion_facts
       ORDER BY completion_sequence`,
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

  it('does not create completion facts for a task outside the workspace scope', async () => {
    const repository = new PostgresTaskCompletionRepository(createSqlClient());

    await expect(
      repository.transitionTaskCompletion(OTHER_WORKSPACE_ID, TASK_ID, {
        status: 'done',
        completedAt: RECOMPLETED_AT,
      }),
    ).resolves.toBeUndefined();
    const count = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM ${TEST_SCHEMA}.task_completion_facts
       WHERE workspace_id = $1`,
      [OTHER_WORKSPACE_ID],
    );
    expect(count.rows).toEqual([{ count: '0' }]);
  });
});
