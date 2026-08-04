import type {
  PlanningSearchEntityType,
  PlanningSearchMatchRank,
  PlanningSearchRepository,
  PlanningSearchRepositoryInput,
  PlanningSearchRepositoryRecord,
} from './search';
import type { PlanningSqlClient } from './postgres-planning-repository';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAXIMUM_RESULT_LIMIT = 50;
const MAXIMUM_QUERY_BYTES = 512;
const MAXIMUM_TITLE_BYTES = 1024;

interface PlanningSearchRow {
  entity_type: unknown;
  id: unknown;
  workspace_id: unknown;
  parent_id: unknown;
  title: unknown;
  status: unknown;
  created_at: unknown;
  match_rank: unknown;
}

export class PlanningSearchRepositoryError extends Error {
  constructor() {
    super('Planning search repository data is invalid');
    this.name = 'PlanningSearchRepositoryError';
  }
}

function invalidRepositoryData(): never {
  throw new PlanningSearchRepositoryError();
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidRepositoryData();
  }
  return value.toLowerCase();
}

function requireBoundedText(value: unknown, maximumBytes: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    return invalidRepositoryData();
  }
  return value;
}

function requirePositiveLimit(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAXIMUM_RESULT_LIMIT
  ) {
    return invalidRepositoryData();
  }
  return value as number;
}

function requireEntityType(value: unknown): PlanningSearchEntityType {
  if (value !== 'goal' && value !== 'project' && value !== 'task') {
    return invalidRepositoryData();
  }
  return value;
}

function requireMatchRank(value: unknown): PlanningSearchMatchRank {
  if (value !== 0 && value !== 1 && value !== 2) {
    return invalidRepositoryData();
  }
  return value;
}

function requireTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return invalidRepositoryData();
    }
    return value.toISOString();
  }
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    return invalidRepositoryData();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return invalidRepositoryData();
  }
  return new Date(parsed).toISOString();
}

function requirePreparedInput(
  input: PlanningSearchRepositoryInput,
): PlanningSearchRepositoryInput {
  if (!input || typeof input !== 'object') {
    return invalidRepositoryData();
  }
  const workspaceId = requireUuid(input.workspaceId);
  const normalizedQuery = requireBoundedText(
    input.normalizedQuery,
    MAXIMUM_QUERY_BYTES,
  );
  const escapedQuery = requireBoundedText(
    input.escapedQuery,
    MAXIMUM_QUERY_BYTES * 2,
  );
  if (
    !Array.isArray(input.escapedTokens) ||
    input.escapedTokens.length === 0 ||
    input.escapedTokens.length > 120
  ) {
    return invalidRepositoryData();
  }
  const escapedTokens = input.escapedTokens.map((token) =>
    requireBoundedText(token, MAXIMUM_QUERY_BYTES * 2),
  );
  return {
    workspaceId,
    normalizedQuery,
    escapedQuery,
    escapedTokens,
    perEntityLimit: requirePositiveLimit(input.perEntityLimit),
    resultLimit: requirePositiveLimit(input.resultLimit),
  };
}

function parseRow(
  row: PlanningSearchRow,
  expectedWorkspaceId: string,
): PlanningSearchRepositoryRecord {
  if (!row || typeof row !== 'object') {
    return invalidRepositoryData();
  }
  const entityType = requireEntityType(row.entity_type);
  const workspaceId = requireUuid(row.workspace_id);
  if (workspaceId !== expectedWorkspaceId) {
    return invalidRepositoryData();
  }
  const parsed: PlanningSearchRepositoryRecord = {
    entityType,
    id: requireUuid(row.id),
    workspaceId,
    title: requireBoundedText(row.title, MAXIMUM_TITLE_BYTES),
    createdAt: requireTimestamp(row.created_at),
    matchRank: requireMatchRank(row.match_rank),
  };
  if (entityType === 'goal') {
    if (row.parent_id !== null || row.status !== null) {
      return invalidRepositoryData();
    }
    return parsed;
  }
  parsed.parentId = requireUuid(row.parent_id);
  if (entityType === 'project') {
    if (row.status !== null) {
      return invalidRepositoryData();
    }
    return parsed;
  }
  if (row.status !== 'todo' && row.status !== 'done') {
    return invalidRepositoryData();
  }
  parsed.status = row.status;
  return parsed;
}

const SEARCH_SQL = `WITH
  goal_matches AS (
    SELECT
      'goal'::text AS entity_type,
      id,
      workspace_id,
      NULL::uuid AS parent_id,
      title,
      NULL::text AS status,
      created_at,
      CASE
        WHEN lower(normalize(title, NFKC)) = $2 THEN 0
        WHEN lower(normalize(title, NFKC)) LIKE $3 || '%' ESCAPE '\\' THEN 1
        ELSE 2
      END AS match_rank
    FROM planning.goals
    WHERE workspace_id = $1
      AND (
        lower(normalize(title, NFKC)) = $2
        OR lower(normalize(title, NFKC)) LIKE $3 || '%' ESCAPE '\\'
        OR NOT EXISTS (
          SELECT 1
          FROM unnest($4::text[]) AS query_token(value)
          WHERE lower(normalize(title, NFKC))
            NOT LIKE '%' || query_token.value || '%' ESCAPE '\\'
        )
      )
    ORDER BY match_rank ASC, created_at DESC, id ASC
    LIMIT $5
  ),
  project_matches AS (
    SELECT
      'project'::text AS entity_type,
      id,
      workspace_id,
      goal_id AS parent_id,
      title,
      NULL::text AS status,
      created_at,
      CASE
        WHEN lower(normalize(title, NFKC)) = $2 THEN 0
        WHEN lower(normalize(title, NFKC)) LIKE $3 || '%' ESCAPE '\\' THEN 1
        ELSE 2
      END AS match_rank
    FROM planning.projects
    WHERE workspace_id = $1
      AND (
        lower(normalize(title, NFKC)) = $2
        OR lower(normalize(title, NFKC)) LIKE $3 || '%' ESCAPE '\\'
        OR NOT EXISTS (
          SELECT 1
          FROM unnest($4::text[]) AS query_token(value)
          WHERE lower(normalize(title, NFKC))
            NOT LIKE '%' || query_token.value || '%' ESCAPE '\\'
        )
      )
    ORDER BY match_rank ASC, created_at DESC, id ASC
    LIMIT $5
  ),
  task_matches AS (
    SELECT
      'task'::text AS entity_type,
      id,
      workspace_id,
      project_id AS parent_id,
      title,
      status,
      created_at,
      CASE
        WHEN lower(normalize(title, NFKC)) = $2 THEN 0
        WHEN lower(normalize(title, NFKC)) LIKE $3 || '%' ESCAPE '\\' THEN 1
        ELSE 2
      END AS match_rank
    FROM planning.tasks
    WHERE workspace_id = $1
      AND (
        lower(normalize(title, NFKC)) = $2
        OR lower(normalize(title, NFKC)) LIKE $3 || '%' ESCAPE '\\'
        OR NOT EXISTS (
          SELECT 1
          FROM unnest($4::text[]) AS query_token(value)
          WHERE lower(normalize(title, NFKC))
            NOT LIKE '%' || query_token.value || '%' ESCAPE '\\'
        )
      )
    ORDER BY match_rank ASC, created_at DESC, id ASC
    LIMIT $5
  )
SELECT
  entity_type,
  id,
  workspace_id,
  parent_id,
  title,
  status,
  created_at,
  match_rank
FROM (
  SELECT * FROM goal_matches
  UNION ALL
  SELECT * FROM project_matches
  UNION ALL
  SELECT * FROM task_matches
) AS planning_matches
ORDER BY
  match_rank ASC,
  CASE entity_type WHEN 'goal' THEN 0 WHEN 'project' THEN 1 ELSE 2 END ASC,
  created_at DESC,
  id ASC
LIMIT $6`;

export class PostgresPlanningSearchRepository
  implements PlanningSearchRepository
{
  constructor(private readonly client: PlanningSqlClient) {}

  async searchPlanning(
    inputValue: PlanningSearchRepositoryInput,
  ): Promise<PlanningSearchRepositoryRecord[]> {
    const input = requirePreparedInput(inputValue);
    const result = await this.client.query<PlanningSearchRow>(SEARCH_SQL, [
      input.workspaceId,
      input.normalizedQuery,
      input.escapedQuery,
      input.escapedTokens,
      input.perEntityLimit,
      input.resultLimit,
    ]);
    if (!Array.isArray(result.rows) || result.rows.length > input.resultLimit) {
      return invalidRepositoryData();
    }
    return result.rows.map((row) => parseRow(row, input.workspaceId));
  }
}
