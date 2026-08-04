import { describe, expect, it } from 'vitest';
import {
  PlanningPersistenceError,
  type PlanningSqlClient,
  type PlanningSqlQueryResult,
  PostgresPlanningRepository,
} from './postgres-planning-repository';
import { requirePlanningSearchInput } from './search';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const CREATED_AT = '2026-08-04T01:00:00.000Z';

class RecordingSearchClient implements PlanningSqlClient {
  text = '';
  values: readonly unknown[] = [];

  constructor(private readonly rows: unknown[]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    this.text = text;
    this.values = values;
    return { rows: this.rows as Row[] };
  }
}

describe('PostgresPlanningRepository search', () => {
  it('uses parameterized tenant filters, Unicode normalization, and bounded ranking', async () => {
    const client = new RecordingSearchClient([
      {
        entity_type: 'goal',
        id: GOAL_ID,
        workspace_id: WORKSPACE_ID,
        parent_id: null,
        title: 'Launch plan',
        status: null,
        created_at: CREATED_AT,
      },
      {
        entity_type: 'project',
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        parent_id: GOAL_ID,
        title: 'Launch plan execution',
        status: null,
        created_at: CREATED_AT,
      },
      {
        entity_type: 'task',
        id: TASK_ID,
        workspace_id: WORKSPACE_ID,
        parent_id: PROJECT_ID,
        title: 'Draft launch plan',
        status: 'todo',
        created_at: CREATED_AT,
      },
    ]);
    const repository = new PostgresPlanningRepository(client);
    const input = requirePlanningSearchInput('100%_ Launch', 3);

    await expect(
      repository.searchCandidates(WORKSPACE_ID, input),
    ).resolves.toEqual([
      {
        entityType: 'goal',
        id: GOAL_ID,
        workspaceId: WORKSPACE_ID,
        title: 'Launch plan',
        createdAt: CREATED_AT,
      },
      {
        entityType: 'project',
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        parentId: GOAL_ID,
        title: 'Launch plan execution',
        createdAt: CREATED_AT,
      },
      {
        entityType: 'task',
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        parentId: PROJECT_ID,
        title: 'Draft launch plan',
        status: 'todo',
        createdAt: CREATED_AT,
      },
    ]);

    expect(client.text).toContain('WHERE workspace_id = $1');
    expect(client.text).toContain('normalize');
    expect(client.text).toContain('NFKC');
    expect(client.text).toContain("plainto_tsquery('simple', $2)");
    expect(client.text).toContain('LIMIT $4');
    expect(client.text).not.toContain(input.normalizedQuery);
    expect(client.values).toEqual([
      WORKSPACE_ID,
      '100%_ launch',
      '100\\%\\_ launch%',
      3,
    ]);
  });

  it.each([
    {
      entity_type: 'unknown',
      id: GOAL_ID,
      workspace_id: WORKSPACE_ID,
      parent_id: null,
      title: 'Invalid type',
      status: null,
      created_at: CREATED_AT,
    },
    {
      entity_type: 'goal',
      id: GOAL_ID,
      workspace_id: WORKSPACE_ID,
      parent_id: PROJECT_ID,
      title: 'Invalid goal parent',
      status: null,
      created_at: CREATED_AT,
    },
    {
      entity_type: 'project',
      id: PROJECT_ID,
      workspace_id: WORKSPACE_ID,
      parent_id: GOAL_ID,
      title: 'Invalid project status',
      status: 'todo',
      created_at: CREATED_AT,
    },
    {
      entity_type: 'task',
      id: TASK_ID,
      workspace_id: WORKSPACE_ID,
      parent_id: PROJECT_ID,
      title: 'Invalid task status',
      status: 'blocked',
      created_at: CREATED_AT,
    },
    {
      entity_type: 'goal',
      id: GOAL_ID,
      workspace_id: OTHER_WORKSPACE_ID,
      parent_id: null,
      title: 'Cross workspace',
      status: null,
      created_at: CREATED_AT,
    },
  ])('fails closed on malformed search row %#', async (row) => {
    const repository = new PostgresPlanningRepository(
      new RecordingSearchClient([row]),
    );

    await expect(
      repository.searchCandidates(
        WORKSPACE_ID,
        requirePlanningSearchInput('invalid'),
      ),
    ).rejects.toBeInstanceOf(PlanningPersistenceError);
  });

  it('rejects a non-UUID durable workspace before querying', async () => {
    const client = new RecordingSearchClient([]);
    const repository = new PostgresPlanningRepository(client);

    await expect(
      repository.searchCandidates(
        'workspace-a',
        requirePlanningSearchInput('launch'),
      ),
    ).rejects.toBeInstanceOf(PlanningPersistenceError);
    expect(client.text).toBe('');
  });
});
