import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.PLANNING_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const TEST_SCHEMA = 'planning_task_completion_fact_chronology_test';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '88888888-8888-4888-8888-888888888888';
const COMPLETION_FACT_ID = '99999999-9999-4999-8999-999999999999';
const CREATED_AT = '2026-09-10T15:00:00.000Z';
const BACKDATED_COMPLETED_AT = '2026-09-10T14:59:59.000Z';
const migrationPath = resolve(
  __dirname,
  '../migrations/0007_task_completion_facts.sql',
);
let pool: Pool;

/** Rewrites Planning-owned qualifiers into the isolated PostgreSQL test schema. */
function isolatedSql(text: string): string {
  return text.replaceAll('planning.', `${TEST_SCHEMA}.`);
}

describeWithPostgres('Planning completion-fact chronology', () => {
  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('PLANNING_DATABASE_URL is required for integration tests');
    }
    pool = new Pool({
      connectionString: DATABASE_URL,
      application_name: 'life-os-planning-completion-fact-chronology-test',
      max: 1,
    });
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await pool.query(
      `CREATE TABLE ${TEST_SCHEMA}.tasks (
         id uuid PRIMARY KEY,
         workspace_id uuid NOT NULL,
         created_at timestamptz NOT NULL,
         CONSTRAINT task_completion_fact_chronology_task_scope_unique
           UNIQUE (id, workspace_id)
       )`,
    );
    const migration = await readFile(migrationPath, 'utf8');
    await pool.query(isolatedSql(migration));
    await pool.query(
      `INSERT INTO ${TEST_SCHEMA}.tasks (id, workspace_id, created_at)
       VALUES ($1, $2, $3::timestamptz)`,
      [TASK_ID, WORKSPACE_ID, CREATED_AT],
    );
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.end();
  });

  it('rejects a durable completion fact that predates its owning task', async () => {
    await expect(
      pool.query(
        `INSERT INTO ${TEST_SCHEMA}.task_completion_facts
           (completion_fact_id, workspace_id, task_id, completed_at)
         VALUES ($1, $2, $3, $4::timestamptz)`,
        [COMPLETION_FACT_ID, WORKSPACE_ID, TASK_ID, BACKDATED_COMPLETED_AT],
      ),
    ).rejects.toMatchObject({
      code: '23514',
      constraint: 'task_completion_facts_chronology_check',
    });
  });
});
