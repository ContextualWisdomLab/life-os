import { describe, expect, it } from 'vitest';
import type { Goal, Project, Task } from './planning-domain';
import {
  PlanningSqlClient,
  PostgresPlanningRepository,
} from './postgres-planning-repository';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_WORKSPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GOAL_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = '2026-08-03T14:30:00.000Z';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

class FakePlanningSqlClient implements PlanningSqlClient {
  readonly calls: QueryCall[] = [];
  private readonly responses: unknown[][] = [];

  enqueue(rows: unknown[]): void {
    this.responses.push(rows);
  }

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values });
    return { rows: (this.responses.shift() ?? []) as Row[] };
  }
}

function goal(): Goal {
  return {
    id: GOAL_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Durable planning',
    createdAt: CREATED_AT,
  };
}

function project(): Project {
  return {
    id: PROJECT_ID,
    workspaceId: WORKSPACE_ID,
    goalId: GOAL_ID,
    title: 'PostgreSQL repository',
    createdAt: CREATED_AT,
  };
}

function task(): Task {
  return {
    id: TASK_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    title: 'Bind every value',
    status: 'todo',
    createdAt: CREATED_AT,
  };
}

describe('PostgresPlanningRepository', () => {
  it('persists the hierarchy with bound values only', async () => {
    const database = new FakePlanningSqlClient();
    const repository = new PostgresPlanningRepository(database);

    await repository.saveGoal(goal());
    await repository.saveProject(project());
    await repository.saveTask(task());

    expect(database.calls).toHaveLength(3);
    expect(database.calls[0]?.text).toContain(
      'INSERT INTO planning.goals',
    );
    expect(database.calls[0]?.values).toEqual([
      GOAL_ID,
      WORKSPACE_ID,
      'Durable planning',
      CREATED_AT,
    ]);
    expect(database.calls[1]?.text).toContain(
      'INSERT INTO planning.projects',
    );
    expect(database.calls[1]?.values).toEqual([
      PROJECT_ID,
      WORKSPACE_ID,
      GOAL_ID,
      'PostgreSQL repository',
      CREATED_AT,
    ]);
    expect(database.calls[2]?.text).toContain(
      'INSERT INTO planning.tasks',
    );
    expect(database.calls[2]?.values).toEqual([
      TASK_ID,
      WORKSPACE_ID,
      PROJECT_ID,
      'Bind every value',
      'todo',
      CREATED_AT,
    ]);
  });

  it('scopes project reads to the workspace and returns stable creation order', async () => {
    const database = new FakePlanningSqlClient();
    database.enqueue([
      {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        goal_id: GOAL_ID,
        goal_workspace_id: WORKSPACE_ID,
        title: 'PostgreSQL repository',
        created_at: new Date(CREATED_AT),
      },
    ]);
    const repository = new PostgresPlanningRepository(database);

    await expect(
      repository.listProjects(WORKSPACE_ID, GOAL_ID),
    ).resolves.toEqual([project()]);
    expect(database.calls[0]?.values).toEqual([WORKSPACE_ID, GOAL_ID]);
    expect(database.calls[0]?.text).toContain(
      'planning.projects.workspace_id = $1',
    );
    expect(database.calls[0]?.text).toContain(
      'ORDER BY planning.projects.created_at ASC, planning.projects.id ASC',
    );
  });

  it('fails closed when a stored project parent belongs to another workspace', async () => {
    const database = new FakePlanningSqlClient();
    database.enqueue([
      {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        goal_id: GOAL_ID,
        goal_workspace_id: OTHER_WORKSPACE_ID,
        title: 'Cross-tenant project',
        created_at: CREATED_AT,
      },
    ]);
    const repository = new PostgresPlanningRepository(database);

    await expect(
      repository.findProject(WORKSPACE_ID, PROJECT_ID),
    ).rejects.toThrowError('Stored planning project is invalid');
  });

  it('fails closed on malformed task status and identifiers', async () => {
    const database = new FakePlanningSqlClient();
    database.enqueue([
      {
        id: '123',
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        project_workspace_id: WORKSPACE_ID,
        title: 'Malformed task',
        status: 'blocked',
        created_at: CREATED_AT,
      },
    ]);
    const repository = new PostgresPlanningRepository(database);

    await expect(
      repository.listTasks(WORKSPACE_ID, PROJECT_ID),
    ).rejects.toThrowError('Stored planning task is invalid');
  });

  it('rejects duplicate rows from an identifier lookup', async () => {
    const database = new FakePlanningSqlClient();
    const row = {
      id: GOAL_ID,
      workspace_id: WORKSPACE_ID,
      title: 'Duplicate goal',
      created_at: CREATED_AT,
    };
    database.enqueue([row, row]);
    const repository = new PostgresPlanningRepository(database);

    await expect(
      repository.findGoal(WORKSPACE_ID, GOAL_ID),
    ).rejects.toThrowError('Stored planning goal is invalid');
  });

  it('validates proposed records before issuing SQL', async () => {
    const database = new FakePlanningSqlClient();
    const repository = new PostgresPlanningRepository(database);

    await expect(
      repository.saveGoal({ ...goal(), id: 'numeric-123' }),
    ).rejects.toThrowError('Stored planning goal is invalid');
    expect(database.calls).toEqual([]);
  });
});
