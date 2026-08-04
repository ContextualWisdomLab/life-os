import { describe, expect, it } from 'vitest';
import {
  normalizePlanningSearchQuery,
  parsePlanningSearchRequest,
  PlanningSearchPersistenceError,
  PlanningSearchService,
  PlanningSearchValidationError,
  type PlanningSearchRepository,
  type PlanningSearchRepositoryInput,
  type PlanningSearchRepositoryRecord,
} from './search';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';

class RecordingSearchRepository implements PlanningSearchRepository {
  readonly inputs: PlanningSearchRepositoryInput[] = [];

  constructor(private readonly records: PlanningSearchRepositoryRecord[]) {}

  async searchPlanning(
    input: PlanningSearchRepositoryInput,
  ): Promise<PlanningSearchRepositoryRecord[]> {
    this.inputs.push(input);
    return this.records;
  }
}

function record(
  overrides: Partial<PlanningSearchRepositoryRecord> = {},
): PlanningSearchRepositoryRecord {
  return {
    entityType: 'task',
    id: TASK_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Ship planning search',
    parentId: PROJECT_ID,
    status: 'todo',
    createdAt: '2026-08-04T01:00:00.000Z',
    matchRank: 2,
    ...overrides,
  };
}

describe('planning search query contract', () => {
  it('normalizes Unicode compatibility forms, case, and whitespace', () => {
    expect(normalizePlanningSearchQuery('  ＳＨＩＰ\tSearch  ')).toEqual({
      normalizedQuery: 'ship search',
      escapedQuery: 'ship search',
      escapedTokens: ['ship', 'search'],
    });
  });

  it('escapes literal PostgreSQL wildcard characters', () => {
    expect(normalizePlanningSearchQuery('50% _ready\\now')).toEqual({
      normalizedQuery: '50% _ready\\now',
      escapedQuery: '50\\% \\_ready\\\\now',
      escapedTokens: ['50\\%', '\\_ready\\\\now'],
    });
  });

  it('rejects empty, numeric-only, control-bearing, non-string, and oversized queries', () => {
    for (const query of [
      '',
      '   ',
      '123 456',
      'find\nme',
      null,
      42,
      'x'.repeat(121),
      '가'.repeat(121),
    ]) {
      expect(() => normalizePlanningSearchQuery(query)).toThrowError(
        PlanningSearchValidationError,
      );
    }
  });

  it('accepts only q and one bounded integer limit', () => {
    expect(parsePlanningSearchRequest({ q: 'Ship', limit: '12' })).toEqual({
      query: 'Ship',
      limit: 12,
    });
    expect(parsePlanningSearchRequest({ q: 'Ship' })).toEqual({
      query: 'Ship',
      limit: 20,
    });

    for (const query of [
      {},
      { q: ['Ship'] },
      { q: 'Ship', limit: ['2'] },
      { q: 'Ship', limit: '0' },
      { q: 'Ship', limit: '51' },
      { q: 'Ship', limit: '1.5' },
      { q: 'Ship', workspaceId: WORKSPACE_ID },
      { q: 'Ship', extra: 'unsafe' },
    ]) {
      expect(() => parsePlanningSearchRequest(query)).toThrowError(
        PlanningSearchValidationError,
      );
    }
  });
});

describe('PlanningSearchService', () => {
  it('passes one bounded tenant-scoped repository request', async () => {
    const repository = new RecordingSearchRepository([record()]);
    const service = new PlanningSearchService(repository);

    await expect(
      service.search(WORKSPACE_ID, 'Ship Search', 7),
    ).resolves.toEqual([
      {
        entityType: 'task',
        id: TASK_ID,
        title: 'Ship planning search',
        parentId: PROJECT_ID,
        status: 'todo',
        createdAt: '2026-08-04T01:00:00.000Z',
      },
    ]);
    expect(repository.inputs).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        normalizedQuery: 'ship search',
        escapedQuery: 'ship search',
        escapedTokens: ['ship', 'search'],
        perEntityLimit: 7,
        resultLimit: 7,
      },
    ]);
  });

  it('sorts exact, prefix, token, entity, newest, and opaque-ID ties deterministically', async () => {
    const repository = new RecordingSearchRepository([
      record({ id: TASK_ID, matchRank: 2, createdAt: '2026-08-04T01:00:00Z' }),
      record({
        entityType: 'goal',
        id: GOAL_ID,
        parentId: undefined,
        status: undefined,
        title: 'Ship',
        matchRank: 0,
        createdAt: '2026-08-01T01:00:00Z',
      }),
      record({
        entityType: 'project',
        id: PROJECT_ID,
        parentId: GOAL_ID,
        status: undefined,
        title: 'Ship search project',
        matchRank: 1,
        createdAt: '2026-08-03T01:00:00Z',
      }),
      record({
        id: '55555555-5555-4555-8555-555555555555',
        matchRank: 2,
        createdAt: '2026-08-04T02:00:00Z',
      }),
    ]);
    const service = new PlanningSearchService(repository);

    const results = await service.search(WORKSPACE_ID, 'ship', 4);
    expect(results.map((result) => result.id)).toEqual([
      GOAL_ID,
      PROJECT_ID,
      '55555555-5555-4555-8555-555555555555',
      TASK_ID,
    ]);
  });

  it('fails closed on cross-tenant, malformed, or excessive repository data', async () => {
    const invalidSets: PlanningSearchRepositoryRecord[][] = [
      [record({ workspaceId: OTHER_WORKSPACE_ID })],
      [record({ id: 'numeric-123' })],
      [record({ title: '' })],
      [record({ matchRank: 3 as 0 })],
      [record({ createdAt: 'not-a-date' })],
      [record({ entityType: 'goal', parentId: PROJECT_ID })],
      [record({ entityType: 'project', parentId: undefined })],
      [record({ entityType: 'project', status: 'todo' })],
      [record({ status: 'blocked' as 'todo' })],
      Array.from({ length: 3 }, (_, index) =>
        record({
          id: `60000000-0000-4000-8000-00000000000${index}`,
        }),
      ),
    ];

    for (const records of invalidSets) {
      const service = new PlanningSearchService(
        new RecordingSearchRepository(records),
      );
      await expect(
        service.search(WORKSPACE_ID, 'ship', 2),
      ).rejects.toBeInstanceOf(PlanningSearchPersistenceError);
    }
  });

  it('rejects malformed workspace identifiers before repository access', async () => {
    const repository = new RecordingSearchRepository([]);
    const service = new PlanningSearchService(repository);

    await expect(service.search('123456', 'ship', 20)).rejects.toBeInstanceOf(
      PlanningSearchValidationError,
    );
    expect(repository.inputs).toEqual([]);
  });
});
