import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Planning task completion chronology migration', () => {
  it('requires status and completion time to describe one coherent durable state', async () => {
    const migration = await readFile(
      resolve(
        __dirname,
        '../migrations/0005_task_completion_chronology.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('tasks_completion_state_check');
    expect(migration).toContain("status = 'todo' AND completed_at IS NULL");
    expect(migration).toContain("status = 'done' AND completed_at IS NOT NULL");
    expect(migration).toContain('completed_at >= created_at');
  });
});
