import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.PLANNING_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '88888888-8888-4888-8888-888888888888';
const COMPLETION_FACT_ID = '99999999-9999-4999-8999-999999999999';
const CREATED_AT = '2026-09-10T15:00:00.000Z';
const COMPLETED_AT = '2026-09-10T16:00:00.000Z';
const migrationPath = resolve(
  __dirname,
  '../migrations/0007_task_completion_facts.sql',
);
let pool: Pool;

function isolatedSql(text: string): string {
  return text.replaceAll('planning.', 'planning_task_completion_truncate_test.');
}

describeWithPostgres(
  'Planning completion fact append-only truncation boundary',
  () => {
    beforeAll(async () => {
      if (!DATABASE_URL) {
        throw new Error(
          'PLANNING_DATABASE_URL is required for integration tests',
        );
      }

      pool = new Pool({
        connectionString: DATABASE_URL,
        application_name: 'life-os-planning-completion-truncate-test',
        max: 2,
      });
      await pool.query(
        'DROP SCHEMA IF EXISTS planning_task_completion_truncate_test CASCADE',
      );
      await pool.query('CREATE SCHEMA planning_task_completion_truncate_test');
      await pool.query(
        `CREATE TABLE planning_task_completion_truncate_test.tasks (
         id uuid PRIMARY KEY,
         workspace_id uuid NOT NULL,
         status text NOT NULL CHECK (status IN ('todo', 'done')),
         created_at timestamptz NOT NULL,
         completed_at timestamptz,
         CONSTRAINT task_truncate_test_id_workspace_unique UNIQUE (id, workspace_id),
         CONSTRAINT task_truncate_test_completion_state_check CHECK (
           (status = 'todo' AND completed_at IS NULL)
           OR (status = 'done' AND completed_at IS NOT NULL AND completed_at >= created_at)
         )
       )`,
      );
      const migration = await readFile(migrationPath, 'utf8');
      await pool.query(isolatedSql(migration));
      await pool.query(
        `INSERT INTO planning_task_completion_truncate_test.tasks
         (id, workspace_id, status, created_at, completed_at)
       VALUES ($1, $2, 'done', $3::timestamptz, $4::timestamptz)`,
        [TASK_ID, WORKSPACE_ID, CREATED_AT, COMPLETED_AT],
      );
      await pool.query(
        `INSERT INTO planning_task_completion_truncate_test.task_completion_facts
         (completion_fact_id, workspace_id, task_id, completed_at)
       VALUES ($1, $2, $3, $4::timestamptz)`,
        [COMPLETION_FACT_ID, WORKSPACE_ID, TASK_ID, COMPLETED_AT],
      );
    });

    afterAll(async () => {
      if (!pool) return;
      await pool.query(
        'DROP SCHEMA IF EXISTS planning_task_completion_truncate_test CASCADE',
      );
      await pool.end();
    });

    it('rejects table-wide truncation while preserving accepted completion evidence', async () => {
      await expect(
        pool.query(
          'TRUNCATE TABLE planning_task_completion_truncate_test.task_completion_facts',
        ),
      ).rejects.toMatchObject({
        code: '23514',
        constraint: 'task_completion_facts_truncate_forbidden',
      });

      const retained = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count
       FROM planning_task_completion_truncate_test.task_completion_facts
       WHERE workspace_id = $1 AND task_id = $2`,
        [WORKSPACE_ID, TASK_ID],
      );
      expect(retained.rows).toEqual([{ count: '1' }]);
    });
  },
);
