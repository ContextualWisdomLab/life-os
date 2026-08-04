const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAXIMUM_QUERY_CHARACTERS = 120;
const MAXIMUM_QUERY_BYTES = 512;
const MAXIMUM_TITLE_CHARACTERS = 160;
const MAXIMUM_TITLE_BYTES = 1024;
const DEFAULT_RESULT_LIMIT = 20;
const MAXIMUM_RESULT_LIMIT = 50;
const ENTITY_ORDER = Object.freeze({ goal: 0, project: 1, task: 2 });

export type PlanningSearchEntityType = keyof typeof ENTITY_ORDER;
export type PlanningSearchMatchRank = 0 | 1 | 2;

export interface NormalizedPlanningSearchQuery {
  normalizedQuery: string;
  escapedQuery: string;
  escapedTokens: readonly string[];
}

export interface PlanningSearchRepositoryInput extends NormalizedPlanningSearchQuery {
  workspaceId: string;
  perEntityLimit: number;
  resultLimit: number;
}

export interface PlanningSearchRepositoryRecord {
  entityType: PlanningSearchEntityType;
  id: string;
  workspaceId: string;
  title: string;
  parentId?: string;
  status?: 'todo' | 'done';
  createdAt: string;
  matchRank: PlanningSearchMatchRank;
}

export interface PlanningSearchResult {
  entityType: PlanningSearchEntityType;
  id: string;
  title: string;
  parentId?: string;
  status?: 'todo' | 'done';
  createdAt: string;
}

export interface PlanningSearchRepository {
  searchPlanning(
    input: PlanningSearchRepositoryInput,
  ): Promise<PlanningSearchRepositoryRecord[]>;
}

export class PlanningSearchValidationError extends Error {
  constructor() {
    super('Planning search request is invalid');
    this.name = 'PlanningSearchValidationError';
  }
}

export class PlanningSearchPersistenceError extends Error {
  constructor() {
    super('Persisted planning search data is invalid');
    this.name = 'PlanningSearchPersistenceError';
  }
}

function invalidRequest(): never {
  throw new PlanningSearchValidationError();
}

function invalidPersistence(): never {
  throw new PlanningSearchPersistenceError();
}

function codePointLength(value: string): number {
  return [...value].length;
}

function requireWorkspaceId(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalidRequest();
  }
  return normalized;
}

function escapeLikeLiteral(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

export function normalizePlanningSearchQuery(
  value: unknown,
): NormalizedPlanningSearchQuery {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    return invalidRequest();
  }
  const normalizedQuery = value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US');
  if (
    !normalizedQuery ||
    /^\d+(?:\s+\d+)*$/u.test(normalizedQuery) ||
    codePointLength(normalizedQuery) > MAXIMUM_QUERY_CHARACTERS ||
    Buffer.byteLength(normalizedQuery, 'utf8') > MAXIMUM_QUERY_BYTES
  ) {
    return invalidRequest();
  }
  const escapedTokens = Object.freeze(
    [...new Set(normalizedQuery.split(' '))].map(escapeLikeLiteral),
  );
  return Object.freeze({
    normalizedQuery,
    escapedQuery: escapeLikeLiteral(normalizedQuery),
    escapedTokens,
  });
}

export function parsePlanningSearchRequest(
  query: Readonly<Record<string, unknown>>,
): { query: string; limit: number } {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    return invalidRequest();
  }
  const keys = Object.keys(query);
  if (keys.some((key) => key !== 'q' && key !== 'limit')) {
    return invalidRequest();
  }
  const queryValue = query.q;
  if (typeof queryValue !== 'string') {
    return invalidRequest();
  }
  const limitValue = query.limit;
  if (limitValue === undefined) {
    return { query: queryValue, limit: DEFAULT_RESULT_LIMIT };
  }
  if (typeof limitValue !== 'string' || !/^[1-9]\d*$/.test(limitValue)) {
    return invalidRequest();
  }
  const limit = Number(limitValue);
  if (!Number.isSafeInteger(limit) || limit > MAXIMUM_RESULT_LIMIT) {
    return invalidRequest();
  }
  return { query: queryValue, limit };
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidPersistence();
  }
  return value.toLowerCase();
}

function requireTitle(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    codePointLength(value) > MAXIMUM_TITLE_CHARACTERS ||
    Buffer.byteLength(value, 'utf8') > MAXIMUM_TITLE_BYTES
  ) {
    return invalidPersistence();
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    return invalidPersistence();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return invalidPersistence();
  }
  return new Date(parsed).toISOString();
}

function requireMatchRank(value: unknown): PlanningSearchMatchRank {
  if (value !== 0 && value !== 1 && value !== 2) {
    return invalidPersistence();
  }
  return value;
}

function parseRecord(
  record: PlanningSearchRepositoryRecord,
  workspaceId: string,
): PlanningSearchRepositoryRecord {
  if (!record || typeof record !== 'object') {
    return invalidPersistence();
  }
  const entityType = record.entityType;
  if (!Object.prototype.hasOwnProperty.call(ENTITY_ORDER, entityType)) {
    return invalidPersistence();
  }
  const parsed: PlanningSearchRepositoryRecord = {
    entityType,
    id: requireUuid(record.id),
    workspaceId: requireUuid(record.workspaceId),
    title: requireTitle(record.title),
    createdAt: requireTimestamp(record.createdAt),
    matchRank: requireMatchRank(record.matchRank),
  };
  if (parsed.workspaceId !== workspaceId) {
    return invalidPersistence();
  }

  if (entityType === 'goal') {
    if (record.parentId !== undefined || record.status !== undefined) {
      return invalidPersistence();
    }
    return parsed;
  }

  parsed.parentId = requireUuid(record.parentId);
  if (entityType === 'project') {
    if (record.status !== undefined) {
      return invalidPersistence();
    }
    return parsed;
  }

  if (record.status !== 'todo' && record.status !== 'done') {
    return invalidPersistence();
  }
  parsed.status = record.status;
  return parsed;
}

function compareRecords(
  left: PlanningSearchRepositoryRecord,
  right: PlanningSearchRepositoryRecord,
): number {
  return (
    left.matchRank - right.matchRank ||
    ENTITY_ORDER[left.entityType] - ENTITY_ORDER[right.entityType] ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function publicResult(
  record: PlanningSearchRepositoryRecord,
): PlanningSearchResult {
  return {
    entityType: record.entityType,
    id: record.id,
    title: record.title,
    ...(record.parentId ? { parentId: record.parentId } : {}),
    ...(record.status ? { status: record.status } : {}),
    createdAt: record.createdAt,
  };
}

export class PlanningSearchService {
  constructor(private readonly repository: PlanningSearchRepository) {}

  async search(
    workspaceIdValue: string,
    queryValue: unknown,
    limit = DEFAULT_RESULT_LIMIT,
  ): Promise<PlanningSearchResult[]> {
    const workspaceId = requireWorkspaceId(workspaceIdValue);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > MAXIMUM_RESULT_LIMIT
    ) {
      return invalidRequest();
    }
    const query = normalizePlanningSearchQuery(queryValue);
    const records = await this.repository.searchPlanning({
      workspaceId,
      ...query,
      perEntityLimit: limit,
      resultLimit: limit,
    });
    if (!Array.isArray(records) || records.length > limit) {
      return invalidPersistence();
    }
    return records
      .map((record) => parseRecord(record, workspaceId))
      .sort(compareRecords)
      .map(publicResult);
  }
}
