import { describe, expect, it } from 'vitest';
import {
  PlanningPersistenceError,
  type PlanningSqlClient,
  type PlanningSqlQueryResult,
  PostgresPlanningRepository,
} from './postgres-planning-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_GOAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-08-03T15:00:00.000Z';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

class RecordingSqlClient implements PlanningSqlClient {
  readonly calls: QueryCall[] = [];
  private readonly responses: unknown[][];

  constructor(...responses: unknown[][]) {
    this.responses = [...responses];
  }

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: (this.responses.shift() ?? []) as Row[] };
  }
}

describe('PostgresPlanningRepository', () => {
  it('binds every persisted value instead of interpolating SQL', async () => {
    const client = new RecordingSqlClient([], [], []);
    const repository = new PostgresPlanningRepository(client);
    const title = "Owner's launch plan";

    await repository.saveGoal({
      id: GOAL_ID,
      workspaceId: WORKSPACE_ID,
      title,
      createdAt: CREATED_AT,
    });
    await repository.saveProject({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      goalId: GOAL_ID,
      title: 'Planning persistence',
      createdAt: CREATED_AT,
    });
    await repository.saveTask({
      id: TASK_ID,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      title: 'Bind SQL values',
      status: 'todo',
      createdAt: CREATED_AT,
    });

    expect(client.calls).toHaveLength(3);
    expect(client.calls[0]?.text).toContain('VALUES ($1, $2, $3, $4)');
    expect(client.calls[0]?.text).not.toContain(title);
    expect(client.calls[0]?.values).toEqual([
      GOAL_ID,
      WORKSPACE_ID,
      title,
      CREATED_AT,
    ]);
    expect(client.calls[1]?.values).toEqual([
      PROJECT_ID,
      WORKSPACE_ID,
      GOAL_ID,
      'Planning persistence',
      CREATED_AT,
    ]);
    expect(client.calls[2]?.values).toEqual([
      TASK_ID,
      WORKSPACE_ID,
      PROJECT_ID,
      'Bind SQL values',
      'todo',
      CREATED_AT,
    ]);
  });

  it('requires tenant filters, parent joins, and deterministic ordering', async () => {
    const client = new RecordingSqlClient(
      [
        {
          id: GOAL_ID,
          workspace_id: WORKSPACE_ID,
          title: 'Durable planning',
          created_at: new Date(CREATED_AT),
        },
      ],
      [
        {
          id: PROJECT_ID,
          workspace_id: WORKSPACE_ID,
          goal_id: GOAL_ID,
          goal_workspace_id: WORKSPACE_ID,
          title: 'PostgreSQL adapter',
          created_at: CREATED_AT,
        },
      ],
      [
        {
          id: TASK_ID,
          workspace_id: WORKSPACE_ID,
          project_id: PROJECT_ID,
          project_workspace_id: WORKSPACE_ID,
          title: 'Validate rows',
          status: 'todo',
          created_at: CREATED_AT,
        },
      ],
    );
    const repository = new PostgresPlanningRepository(client);

    await expect(repository.listGoals(WORKSPACE_ID)).resolves.toEqual([
      {
        id: GOAL_ID,
        workspaceId: WORKSPACE_ID,
        title: 'Durable planning',
        createdAt: CREATED_AT,
      },
    ]);
    await expect(
      repository.listProjects(WORKSPACE_ID, GOAL_ID),
    ).resolves.toEqual([
      {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        goalId: GOAL_ID,
        title: 'PostgreSQL adapter',
        createdAt: CREATED_AT,
      },
    ]);
    await expect(
      repository.listTasks(WORKSPACE_ID, PROJECT_ID),
    ).resolves.toEqual([
      {
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        title: 'Validate rows',
        status: 'todo',
        createdAt: CREATED_AT,
      },
    ]);

    expect(client.calls[0]?.text).toContain('WHERE workspace_id = $1');
    expect(client.calls[0]?.text).toContain('ORDER BY created_at ASC, id ASC');
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID]);
    expect(client.calls[1]?.text).toContain('JOIN planning.goals');
    expect(client.calls[1]?.values).toEqual([WORKSPACE_ID, GOAL_ID]);
    expect(client.calls[2]?.text).toContain('JOIN planning.projects');
    expect(client.calls[2]?.values).toEqual([WORKSPACE_ID, PROJECT_ID]);
  });

  it('fails closed on malformed persisted task data', async () => {
    const client = new RecordingSqlClient([
      {
        id: TASK_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PROJECT_ID,
        project_workspace_id: WORKSPACE_ID,
        title: 'Malformed timestamp',
        status: 'todo',
        created_at: 'August 3, 2026',
      },
    ]);
    const repository = new PostgresPlanningRepository(client);

    await expect(
      repository.listTasks(WORKSPACE_ID, PROJECT_ID),
    ).rejects.toBeInstanceOf(PlanningPersistenceError);
  });

  it('fails closed when a row crosses the requested workspace boundary', async () => {
    const client = new RecordingSqlClient([
      {
        id: GOAL_ID,
        workspace_id: OTHER_WORKSPACE_ID,
        title: 'Cross-tenant row',
        created_at: CREATED_AT,
      },
    ]);
    const repository = new PostgresPlanningRepository(client);

    await expect(repository.listGoals(WORKSPACE_ID)).rejects.toBeInstanceOf(
      PlanningPersistenceError,
    );
  });

  it('fails closed when persisted parent ownership is inconsistent', async () => {
    const client = new RecordingSqlClient([
      {
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        goal_id: GOAL_ID,
        goal_workspace_id: OTHER_WORKSPACE_ID,
        title: 'Cross-tenant parent',
        created_at: CREATED_AT,
      },
    ]);
    const repository = new PostgresPlanningRepository(client);

    await expect(
      repository.listProjects(WORKSPACE_ID, GOAL_ID),
    ).rejects.toBeInstanceOf(PlanningPersistenceError);
  });

  it('rejects malformed identifiers before querying PostgreSQL', async () => {
    const client = new RecordingSqlClient();
    const repository = new PostgresPlanningRepository(client);

    await expect(repository.listGoals('workspace-a')).rejects.toBeInstanceOf(
      PlanningPersistenceError,
    );
    await expect(
      repository.saveGoal({
        id: 'not-a-uuid',
        workspaceId: WORKSPACE_ID,
        title: 'Invalid identifier',
        createdAt: CREATED_AT,
      }),
    ).rejects.toBeInstanceOf(PlanningPersistenceError);
    expect(client.calls).toEqual([]);
  });

  it('returns undefined only when a tenant-scoped lookup has no row', async () => {
    const client = new RecordingSqlClient([]);
    const repository = new PostgresPlanningRepository(client);

    await expect(
      repository.findGoal(WORKSPACE_ID, GOAL_ID),
    ).resolves.toBeUndefined();
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, GOAL_ID]);
    expect(client.calls[0]?.text).toContain('LIMIT 2');
  });

  it('fails closed when a lookup returns an unexpected identifier', async () => {
    const client = new RecordingSqlClient([
      {
        id: OTHER_GOAL_ID,
        workspace_id: WORKSPACE_ID,
        title: 'Unexpected row',
        created_at: CREATED_AT,
      },
    ]);
    const repository = new PostgresPlanningRepository(client);

    await expect(
      repository.findGoal(WORKSPACE_ID, GOAL_ID),
    ).rejects.toBeInstanceOf(PlanningPersistenceError);
  });

  it('fails closed if a supposedly unique lookup returns multiple rows', async () => {
    const row = {
      id: GOAL_ID,
      workspace_id: WORKSPACE_ID,
      title: 'Duplicate row',
      created_at: CREATED_AT,
    };
    const client = new RecordingSqlClient([row, row]);
    const repository = new PostgresPlanningRepository(client);

    await expect(
      repository.findGoal(WORKSPACE_ID, GOAL_ID),
    ).rejects.toBeInstanceOf(PlanningPersistenceError);
  });
});
