import { describe, expect, it } from 'vitest';
import type {
  PlanningSqlClient,
  PlanningSqlQueryResult,
} from './postgres-planning-repository';
import {
  PostgresPlanningSearchRepository,
  PlanningSearchRepositoryError,
} from './postgres-planning-search-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

class RecordingSqlClient implements PlanningSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly rows: unknown[]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return { rows: this.rows as Row[] };
  }
}

function input() {
  return {
    workspaceId: WORKSPACE_ID,
    normalizedQuery: 'ship search',
    escapedQuery: 'ship search',
    escapedTokens: ['ship', 'search'],
    perEntityLimit: 8,
    resultLimit: 12,
  } as const;
}

describe('PostgresPlanningSearchRepository', () => {
  it('executes one fixed tenant-scoped parameterized query with per-entity caps', async () => {
    const client = new RecordingSqlClient([
      {
        entity_type: 'goal',
        id: GOAL_ID,
        workspace_id: WORKSPACE_ID,
        parent_id: null,
        title: 'Ship search',
        status: null,
        created_at: new Date('2026-08-04T01:00:00.000Z'),
        match_rank: 0,
      },
      {
        entity_type: 'project',
        id: PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        parent_id: GOAL_ID,
        title: 'Ship search project',
        status: null,
        created_at: '2026-08-04T02:00:00.000Z',
        match_rank: 1,
      },
      {
        entity_type: 'task',
        id: TASK_ID,
        workspace_id: WORKSPACE_ID,
        parent_id: PROJECT_ID,
        title: 'Review search',
        status: 'todo',
        created_at: '2026-08-04T03:00:00.000Z',
        match_rank: 2,
      },
    ]);
    const repository = new PostgresPlanningSearchRepository(client);

    await expect(repository.searchPlanning(input())).resolves.toEqual([
      {
        entityType: 'goal',
        id: GOAL_ID,
        workspaceId: WORKSPACE_ID,
        title: 'Ship search',
        createdAt: '2026-08-04T01:00:00.000Z',
        matchRank: 0,
      },
      {
        entityType: 'project',
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        parentId: GOAL_ID,
        title: 'Ship search project',
        createdAt: '2026-08-04T02:00:00.000Z',
        matchRank: 1,
      },
      {
        entityType: 'task',
        id: TASK_ID,
        workspaceId: WORKSPACE_ID,
        parentId: PROJECT_ID,
        title: 'Review search',
        status: 'todo',
        createdAt: '2026-08-04T03:00:00.000Z',
        matchRank: 2,
      },
    ]);

    expect(client.calls).toHaveLength(1);
    const call = client.calls[0];
    expect(call?.values).toEqual([
      WORKSPACE_ID,
      'ship search',
      'ship search',
      ['ship', 'search'],
      8,
      12,
    ]);
    expect(call?.text).toContain('FROM planning.goals');
    expect(call?.text).toContain('FROM planning.projects');
    expect(call?.text).toContain('FROM planning.tasks');
    expect(call?.text.match(/workspace_id = \$1/g)).toHaveLength(3);
    expect(call?.text.match(/LIMIT \$5/g)).toHaveLength(3);
    expect(call?.text).toContain('LIMIT $6');
    expect(call?.text).toContain('lower(normalize(title, NFKC))');
    expect(call?.text).toContain('unnest($4::text[])');
    expect(call?.text).toContain("ESCAPE '\\'");
    expect(call?.text).not.toContain('ship search');
  });

  it('fails before querying when repository inputs are not already bounded', async () => {
    const invalidInputs = [
      { ...input(), workspaceId: 'workspace-a' },
      { ...input(), normalizedQuery: '' },
      { ...input(), escapedQuery: '' },
      { ...input(), escapedTokens: [] },
      { ...input(), escapedTokens: [''] },
      { ...input(), perEntityLimit: 0 },
      { ...input(), resultLimit: 51 },
      { ...input(), resultLimit: 1.5 },
    ];
    for (const invalidInput of invalidInputs) {
      const client = new RecordingSqlClient([]);
      const repository = new PostgresPlanningSearchRepository(client);
      await expect(
        repository.searchPlanning(invalidInput as ReturnType<typeof input>),
      ).rejects.toBeInstanceOf(PlanningSearchRepositoryError);
      expect(client.calls).toEqual([]);
    }
  });

  it('fails closed on malformed or cross-tenant result rows', async () => {
    const validRow = {
      entity_type: 'task',
      id: TASK_ID,
      workspace_id: WORKSPACE_ID,
      parent_id: PROJECT_ID,
      title: 'Valid task',
      status: 'done',
      created_at: '2026-08-04T03:00:00.000Z',
      match_rank: 2,
    };
    const invalidRows = [
      { ...validRow, entity_type: 'habit' },
      { ...validRow, id: 'not-a-uuid' },
      { ...validRow, workspace_id: OTHER_WORKSPACE_ID },
      { ...validRow, parent_id: null },
      { ...validRow, title: '' },
      { ...validRow, status: 'blocked' },
      { ...validRow, created_at: 'not-a-date' },
      { ...validRow, match_rank: 4 },
      { ...validRow, entity_type: 'goal', parent_id: PROJECT_ID, status: null },
      { ...validRow, entity_type: 'project', status: 'todo' },
    ];

    for (const invalidRow of invalidRows) {
      const repository = new PostgresPlanningSearchRepository(
        new RecordingSqlClient([invalidRow]),
      );
      await expect(repository.searchPlanning(input())).rejects.toBeInstanceOf(
        PlanningSearchRepositoryError,
      );
    }
  });

  it('rejects an upstream response larger than the requested result limit', async () => {
    const rows = Array.from({ length: 13 }, (_, index) => ({
      entity_type: 'task',
      id: `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      workspace_id: WORKSPACE_ID,
      parent_id: PROJECT_ID,
      title: `Task ${index}`,
      status: 'todo',
      created_at: '2026-08-04T03:00:00.000Z',
      match_rank: 2,
    }));
    const repository = new PostgresPlanningSearchRepository(
      new RecordingSqlClient(rows),
    );

    await expect(repository.searchPlanning(input())).rejects.toBeInstanceOf(
      PlanningSearchRepositoryError,
    );
  });
});
