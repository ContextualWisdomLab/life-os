const MINIMUM_SEARCH_QUERY_LENGTH = 2;
const MAXIMUM_SEARCH_QUERY_LENGTH = 120;
const MAXIMUM_SEARCH_TOKENS = 8;
const DEFAULT_SEARCH_LIMIT = 20;
const MAXIMUM_SEARCH_LIMIT = 25;

/** Planning entity kinds included by the unified tenant-scoped search boundary. */
export type PlanningSearchEntityType = 'goal' | 'project' | 'task';

/** Validated search request shared by domain and persistence adapters. */
export interface PlanningSearchInput {
  normalizedQuery: string;
  tokens: readonly string[];
  limit: number;
}

/** Internal tenant-scoped record presented to the deterministic ranker. */
export interface PlanningSearchCandidate {
  entityType: PlanningSearchEntityType;
  id: string;
  workspaceId: string;
  title: string;
  createdAt: string;
  parentId?: string;
  status?: 'todo' | 'done';
}

/** Minimal credential-free record returned by the public planning search API. */
export interface PlanningSearchResult {
  entityType: PlanningSearchEntityType;
  id: string;
  title: string;
  createdAt: string;
  parentId?: string;
  status?: 'todo' | 'done';
}

const ENTITY_ORDER: Readonly<Record<PlanningSearchEntityType, number>> = {
  goal: 0,
  project: 1,
  task: 2,
};

/** Normalizes Unicode and whitespace without changing the stored display title. */
export function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function invalidSearchRequest(): never {
  throw new Error('Planning search request is invalid');
}

/** Parses untrusted query and limit values into one bounded immutable request. */
export function requirePlanningSearchInput(
  query: unknown,
  requestedLimit?: unknown,
): PlanningSearchInput {
  if (typeof query !== 'string') {
    return invalidSearchRequest();
  }
  const normalizedQuery = normalizeSearchText(query);
  if (
    normalizedQuery.length < MINIMUM_SEARCH_QUERY_LENGTH ||
    normalizedQuery.length > MAXIMUM_SEARCH_QUERY_LENGTH ||
    /^\d+$/u.test(normalizedQuery)
  ) {
    return invalidSearchRequest();
  }
  const tokens = [...new Set(normalizedQuery.split(' '))];
  if (tokens.length > MAXIMUM_SEARCH_TOKENS) {
    return invalidSearchRequest();
  }

  let limit = DEFAULT_SEARCH_LIMIT;
  if (requestedLimit !== undefined) {
    const parsed =
      typeof requestedLimit === 'number'
        ? requestedLimit
        : typeof requestedLimit === 'string' && /^\d+$/u.test(requestedLimit)
          ? Number(requestedLimit)
          : Number.NaN;
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < 1 ||
      parsed > MAXIMUM_SEARCH_LIMIT
    ) {
      return invalidSearchRequest();
    }
    limit = parsed;
  }

  return Object.freeze({
    normalizedQuery,
    tokens: Object.freeze(tokens),
    limit,
  });
}

/** Escapes a normalized value for a parameterized SQL LIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, '\\$&');
}

function matchRank(
  normalizedTitle: string,
  input: PlanningSearchInput,
): number | undefined {
  if (normalizedTitle === input.normalizedQuery) {
    return 0;
  }
  if (normalizedTitle.startsWith(input.normalizedQuery)) {
    return 1;
  }
  if (input.tokens.every((token) => normalizedTitle.includes(token))) {
    return 2;
  }
  return undefined;
}

/** Ranks already tenant-scoped candidates and removes internal ownership data. */
export function rankPlanningSearchCandidates(
  candidates: readonly PlanningSearchCandidate[],
  input: PlanningSearchInput,
): PlanningSearchResult[] {
  return candidates
    .map((candidate) => ({
      candidate,
      rank: matchRank(normalizeSearchText(candidate.title), input),
    }))
    .filter(
      (entry): entry is { candidate: PlanningSearchCandidate; rank: number } =>
        entry.rank !== undefined,
    )
    .sort((left, right) => {
      if (left.rank !== right.rank) {
        return left.rank - right.rank;
      }
      const typeDifference =
        ENTITY_ORDER[left.candidate.entityType] -
        ENTITY_ORDER[right.candidate.entityType];
      if (typeDifference !== 0) {
        return typeDifference;
      }
      const timeDifference = right.candidate.createdAt.localeCompare(
        left.candidate.createdAt,
      );
      if (timeDifference !== 0) {
        return timeDifference;
      }
      return left.candidate.id.localeCompare(right.candidate.id);
    })
    .slice(0, input.limit)
    .map(({ candidate }) => {
      const result: PlanningSearchResult = {
        entityType: candidate.entityType,
        id: candidate.id,
        title: candidate.title,
        createdAt: candidate.createdAt,
      };
      if (candidate.parentId !== undefined) {
        result.parentId = candidate.parentId;
      }
      if (candidate.status !== undefined) {
        result.status = candidate.status;
      }
      return result;
    });
}
