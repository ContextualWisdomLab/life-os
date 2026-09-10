import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const stagingMigrationPath = resolve(
  __dirname,
  '../migrations/0005_task_completion_chronology.sql',
);
const validationMigrationPath = resolve(
  __dirname,
  '../migrations/0006_validate_task_completion_chronology.sql',
);

async function readMigration(path: string): Promise<string> {
  return await readFile(path, 'utf8');
}

function normalizeSql(source: string): string {
  return source.replace(/\s+/g, ' ').trim();
}

describe('Planning task completion chronology migration', () => {
  it('stages the coherent completion-state constraint before scanning historical rows', async () => {
    const migration = normalizeSql(await readMigration(stagingMigrationPath));

    expect(migration).toContain('tasks_completion_state_check');
    expect(migration).toContain("status = 'todo' AND completed_at IS NULL");
    expect(migration).toContain("status = 'done' AND completed_at IS NOT NULL");
    expect(migration).toContain('completed_at >= created_at');
    expect(migration).toContain('NOT VALID');
    expect(migration).not.toContain('VALIDATE CONSTRAINT');
  });

  it('validates the staged constraint in a later migration boundary', async () => {
    const migration = normalizeSql(await readMigration(validationMigrationPath));

    expect(migration).toContain(
      'VALIDATE CONSTRAINT tasks_completion_state_check',
    );
    expect(migration).not.toContain('ADD CONSTRAINT');
  });

  const databaseUrl = process.env.PLANNING_DATABASE_URL;
  const databaseIt = databaseUrl ? it : it.skip;

  databaseIt(
    'rejects contradictory new task states and finishes with validated historical chronology',
    async () => {
      const pool = new Pool({ connectionString: databaseUrl });

      try {
        await pool.query(
          'DROP SCHEMA IF EXISTS planning_task_completion_chronology_test CASCADE',
        );
        await pool.query(
          'CREATE SCHEMA planning_task_completion_chronology_test',
        );
        await pool.query(
          "CREATE TABLE planning_task_completion_chronology_test.tasks (status text NOT NULL CHECK (status IN ('todo', 'done')), created_at timestamptz NOT NULL, completed_at timestamptz)",
        );

        const stagingMigration = (
          await readMigration(stagingMigrationPath)
        ).replaceAll(
          'planning.tasks',
          'planning_task_completion_chronology_test.tasks',
        );
        await pool.query(stagingMigration);

        await expect(
          pool.query(
            "INSERT INTO planning_task_completion_chronology_test.tasks (status, created_at, completed_at) VALUES ('todo', $1, NULL)",
            ['2026-09-10T10:00:00.000Z'],
          ),
        ).resolves.toBeDefined();
        await expect(
          pool.query(
            "INSERT INTO planning_task_completion_chronology_test.tasks (status, created_at, completed_at) VALUES ('done', $1, $2)",
            ['2026-09-10T10:00:00.000Z', '2026-09-10T10:05:00.000Z'],
          ),
        ).resolves.toBeDefined();
        await expect(
          pool.query(
            "INSERT INTO planning_task_completion_chronology_test.tasks (status, created_at, completed_at) VALUES ('todo', $1, $2)",
            ['2026-09-10T10:00:00.000Z', '2026-09-10T10:05:00.000Z'],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          pool.query(
            "INSERT INTO planning_task_completion_chronology_test.tasks (status, created_at, completed_at) VALUES ('done', $1, NULL)",
            ['2026-09-10T10:00:00.000Z'],
          ),
        ).rejects.toMatchObject({ code: '23514' });
        await expect(
          pool.query(
            "INSERT INTO planning_task_completion_chronology_test.tasks (status, created_at, completed_at) VALUES ('done', $1, $2)",
            ['2026-09-10T10:05:00.000Z', '2026-09-10T10:00:00.000Z'],
          ),
        ).rejects.toMatchObject({ code: '23514' });

        const validationMigration = (
          await readMigration(validationMigrationPath)
        ).replaceAll(
          'planning.tasks',
          'planning_task_completion_chronology_test.tasks',
        );
        await pool.query(validationMigration);
        const validationState = await pool.query<{ convalidated: boolean }>(
          "SELECT convalidated FROM pg_constraint WHERE conname = 'tasks_completion_state_check' AND conrelid = 'planning_task_completion_chronology_test.tasks'::regclass",
        );

        expect(validationState.rows).toEqual([{ convalidated: true }]);
      } finally {
        await pool.query(
          'DROP SCHEMA IF EXISTS planning_task_completion_chronology_test CASCADE',
        );
        await pool.end();
      }
    },
  );
});
