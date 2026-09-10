import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../migrations/0005_task_completion_chronology.sql',
);

async function readMigration(): Promise<string> {
  return await readFile(migrationPath, 'utf8');
}

describe('Planning task completion chronology migration', () => {
  it('requires status and completion time to describe one coherent durable state', async () => {
    const migration = await readMigration();
    const normalizedMigration = migration.replace(/\s+/g, ' ');

    expect(normalizedMigration).toContain('tasks_completion_state_check');
    expect(normalizedMigration).toContain("status = 'todo' AND completed_at IS NULL");
    expect(normalizedMigration).toContain("status = 'done' AND completed_at IS NOT NULL");
    expect(normalizedMigration).toContain('completed_at >= created_at');
  });

  const databaseUrl = process.env.PLANNING_DATABASE_URL;
  const databaseIt = databaseUrl ? it : it.skip;

  databaseIt(
    'rejects durable task states that would fabricate or contradict completion chronology',
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

        const migration = (await readMigration()).replaceAll(
          'planning.tasks',
          'planning_task_completion_chronology_test.tasks',
        );
        await pool.query(migration);

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
      } finally {
        await pool.query(
          'DROP SCHEMA IF EXISTS planning_task_completion_chronology_test CASCADE',
        );
        await pool.end();
      }
    },
  );
});
