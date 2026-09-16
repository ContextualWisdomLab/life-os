import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.PLANNING_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const TEST_SCHEMA = 'planning_task_completion_fact_source_test';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '88888888-8888-4888-8888-888888888888';
const COMPLETION_FACT_ID = '99999999-9999-4999-8999-999999999999';
const CREATED_AT = '2026-09-10T15:00:00.000Z';
const FORGED_COMPLETED_AT = '2026-09-10T16:00:00.000Z';
const migrationPath = resolve(
  __dirname,
  '../migrations/0007_task_completion_facts.sql',
);
let pool: Pool;

/** Rewrites Planning-owned qualifiers into the isolated PostgreSQL test schema. */
function isolatedSql(text: string): string {
  return text.replaceAll('planning.', `${TEST_SCHEMA}.`);
}

describeWithPostgres('Planning completion-fact source transition', () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('PLANNING_DATABASE_URL is required for integration tests');
    }
    pool = new Pool({
      connectionString: DATABASE_URL,
      application_name: 'life-os-planning-completion-fact-source-test',
      max: 1,
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
         CONSTRAINT task_completion_fact_source_task_scope_unique
           UNIQUE (id, workspace_id),
         CONSTRAINT task_completion_fact_source_state_check CHECK (
           (status = 'todo' AND completed_at IS NULL)
           OR (status = 'done' AND completed_at IS NOT NULL AND completed_at >= created_at)
         )
       )`,
    );
    const migration = await readFile(migrationPath, 'utf8');
    await pool.query(isolatedSql(migration));
    await pool.query(
      `INSERT INTO ${TEST_SCHEMA}.tasks
         (id, workspace_id, status, created_at, completed_at)
       VALUES ($1, $2, 'todo', $3::timestamptz, NULL)`,
      [TASK_ID, WORKSPACE_ID, CREATED_AT],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.end();
  });

  it('rejects a valid-looking fact that did not originate from todo-to-done', async () => {
    await expect(
      pool.query(
        `INSERT INTO ${TEST_SCHEMA}.task_completion_facts
           (completion_fact_id, workspace_id, task_id, completed_at)
         VALUES ($1, $2, $3, $4::timestamptz)`,
        [
          COMPLETION_FACT_ID,
          WORKSPACE_ID,
          TASK_ID,
          FORGED_COMPLETED_AT,
        ],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'task_completion_facts_source_transition_check',
    });

    const task = await pool.query<{
      status: string;
      completed_at: Date | null;
    }>(
      `SELECT status, completed_at
       FROM ${TEST_SCHEMA}.tasks
       WHERE workspace_id = $1 AND id = $2`,
      [WORKSPACE_ID, TASK_ID],
    );
    expect(task.rows).toEqual([{ status: 'todo', completed_at: null }]);

    const facts = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM ${TEST_SCHEMA}.task_completion_facts
       WHERE workspace_id = $1 AND task_id = $2`,
      [WORKSPACE_ID, TASK_ID],
    );
    expect(facts.rows).toEqual([{ count: '0' }]);
  });
});
