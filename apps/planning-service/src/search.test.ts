import { describe, expect, it } from 'vitest';
import {
  escapeLikePattern,
  normalizeSearchText,
  rankPlanningSearchCandidates,
  requirePlanningSearchInput,
  type PlanningSearchCandidate,
} from './search';

const CANDIDATES: PlanningSearchCandidate[] = [
  {
    entityType: 'task',
    id: '44444444-4444-4444-8444-444444444444',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    parentId: '33333333-3333-4333-8333-333333333333',
    title: 'Draft launch plan notes',
    status: 'todo',
    createdAt: '2026-08-06T01:00:00.000Z',
  },
  {
    entityType: 'project',
    id: '33333333-3333-4333-8333-333333333333',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    parentId: '22222222-2222-4222-8222-222222222222',
    title: 'Launch plan',
    createdAt: '2026-08-03T01:00:00.000Z',
  },
  {
    entityType: 'goal',
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    title: 'Launch plan',
    createdAt: '2026-08-02T01:00:00.000Z',
  },
  {
    entityType: 'task',
    id: '55555555-5555-4555-8555-555555555555',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    parentId: '33333333-3333-4333-8333-333333333333',
    title: 'Plan the product launch',
    status: 'done',
    createdAt: '2026-08-05T01:00:00.000Z',
  },
];

describe('planning search request validation', () => {
  it('normalizes Unicode compatibility forms and repeated whitespace', () => {
    expect(normalizeSearchText('  ＬＡＵＮＣＨ\tPlan  ')).toBe('launch plan');
    expect(requirePlanningSearchInput('  ＬＡＵＮＣＨ\tPlan  ', '3')).toEqual({
      normalizedQuery: 'launch plan',
      tokens: ['launch', 'plan'],
      limit: 3,
    });
  });

  it('uses a bounded default and accepts the maximum explicit result limit', () => {
    expect(requirePlanningSearchInput('launch').limit).toBe(20);
    expect(requirePlanningSearchInput('launch', 25).limit).toBe(25);
  });

  it.each([
    [undefined, undefined],
    ['', undefined],
    ['a', undefined],
    ['1234', undefined],
    ['word '.repeat(9), undefined],
    ['x'.repeat(121), undefined],
    ['launch', 0],
    ['launch', 26],
    ['launch', '1.5'],
    ['launch', 'many'],
  ])('rejects malformed or unbounded input %#', (query, limit) => {
    expect(() => requirePlanningSearchInput(query, limit)).toThrowError(
      'Planning search request is invalid',
    );
  });

  it('escapes SQL LIKE metacharacters without altering ordinary text', () => {
    expect(escapeLikePattern('100%_ready\\now')).toBe('100\\%\\_ready\\\\now');
    expect(escapeLikePattern('launch plan')).toBe('launch plan');
  });
});

describe('planning search ranking', () => {
  it('orders exact, prefix, and token matches deterministically', () => {
    const input = requirePlanningSearchInput('launch plan');

    expect(rankPlanningSearchCandidates(CANDIDATES, input)).toEqual([
      {
        entityType: 'goal',
        id: '22222222-2222-4222-8222-222222222222',
        title: 'Launch plan',
        createdAt: '2026-08-02T01:00:00.000Z',
      },
      {
        entityType: 'project',
        id: '33333333-3333-4333-8333-333333333333',
        parentId: '22222222-2222-4222-8222-222222222222',
        title: 'Launch plan',
        createdAt: '2026-08-03T01:00:00.000Z',
      },
      {
        entityType: 'task',
        id: '44444444-4444-4444-8444-444444444444',
        parentId: '33333333-3333-4333-8333-333333333333',
        title: 'Draft launch plan notes',
        status: 'todo',
        createdAt: '2026-08-06T01:00:00.000Z',
      },
      {
        entityType: 'task',
        id: '55555555-5555-4555-8555-555555555555',
        parentId: '33333333-3333-4333-8333-333333333333',
        title: 'Plan the product launch',
        status: 'done',
        createdAt: '2026-08-05T01:00:00.000Z',
      },
    ]);
  });

  it('removes workspace ownership data and applies the requested limit', () => {
    const results = rankPlanningSearchCandidates(
      CANDIDATES,
      requirePlanningSearchInput('launch', 2),
    );

    expect(results).toHaveLength(2);
    expect(results.every((result) => !('workspaceId' in result))).toBe(true);
  });

  it('returns no record when all normalized tokens are absent', () => {
    expect(
      rankPlanningSearchCandidates(
        CANDIDATES,
        requirePlanningSearchInput('private evidence'),
      ),
    ).toEqual([]);
  });
});
