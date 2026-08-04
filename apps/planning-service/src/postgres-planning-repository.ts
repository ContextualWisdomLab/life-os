import type {
  Goal,
  PlanningRepository,
  Project,
  Task,
} from './planning-domain';
import {
  escapeLikePattern,
  type PlanningSearchCandidate,
  type PlanningSearchEntityType,
  type PlanningSearchInput,
} from './search';

/** Generic row collection returned by the minimal PostgreSQL client boundary. */
export interface PlanningSqlQueryResult<Row> {
  rows: Row[];
}

/** Parameterized SQL client surface required by the planning repository. */
export interface PlanningSqlClient {
  /** Executes one statement with separately bound values. */
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>>;
}

/** Untrusted database row shape shared by persisted goals. */
interface GoalRow {
  id: unknown;
  workspace_id: unknown;
  title: unknown;
  created_at: unknown;
}

/** Untrusted project row including its joined goal ownership evidence. */
interface ProjectRow extends GoalRow {
  goal_id: unknown;
  goal_workspace_id: unknown;
}

/** Untrusted task row including its joined project ownership evidence. */
interface TaskRow extends GoalRow {
  project_id: unknown;
  project_workspace_id: unknown;
  status: unknown;
}

/** Untrusted unified-search row returned by the bounded SQL union. */
interface SearchRow extends GoalRow {
  entity_type: unknown;
  parent_id: unknown;
  status: unknown;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const NORMALIZED_TITLE_SQL =
  "lower(normalize(regexp_replace(trim(title), '\\s+', ' ', 'g'), NFKC))";

/** Stable fail-closed error for malformed durable planning data. */
export class PlanningPersistenceError extends Error {
  /** Creates a credential-free persistence validation error. */
  constructor() {
    super('Persisted planning data is invalid');
    this.name = 'PlanningPersistenceError';
  }
}

/** Rejects a malformed row without exposing its contents. */
function invalidRow(): never {
  throw new PlanningPersistenceError();
}

/** Requires a canonical UUIDv4 value from an untrusted database field. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidRow();
  }
  return value.toLowerCase();
}

/** Requires a nonblank display title from an untrusted database field. */
function requireTitle(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return invalidRow();
  }
  return value;
}

/** Converts a valid database timestamp into canonical ISO 8601 form. */
function requireTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return invalidRow();
    }
    return value.toISOString();
  }
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    return invalidRow();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return invalidRow();
  }
  return parsed.toISOString();
}

/** Requires one of the closed task statuses supported by the domain. */
function requireStatus(value: unknown): Task['status'] {
  if (value !== 'todo' && value !== 'done') {
    return invalidRow();
  }
  return value;
}

/** Requires one of the closed entity kinds supported by unified search. */
function requireEntityType(value: unknown): PlanningSearchEntityType {
  if (value !== 'goal' && value !== 'project' && value !== 'task') {
    return invalidRow();
  }
  return value;
}

/** Fails when persisted ownership or identity differs from the query scope. */
function requireExpected(actual: string, expected: string): void {
  if (actual !== expected.toLowerCase()) {
    invalidRow();
  }
}

/** Parses and optionally scope-checks one untrusted goal-shaped row. */
function parseGoal(
  row: GoalRow,
  expectedWorkspaceId?: string,
  expectedId?: string,
): Goal {
  const goal: Goal = {
    id: requireUuidV4(row.id),
    workspaceId: requireUuidV4(row.workspace_id),
    title: requireTitle(row.title),
    createdAt: requireTimestamp(row.created_at),
  };
  if (expectedWorkspaceId) {
    requireExpected(goal.workspaceId, expectedWorkspaceId);
  }
  if (expectedId) {
    requireExpected(goal.id, expectedId);
  }
  return goal;
}

/** Parses a project and verifies its joined parent belongs to the same workspace. */
function parseProject(
  row: ProjectRow,
  expectedWorkspaceId?: string,
  expectedGoalId?: string,
  expectedId?: string,
): Project {
  const project: Project = {
    ...parseGoal(row, expectedWorkspaceId, expectedId),
    goalId: requireUuidV4(row.goal_id),
  };
  const goalWorkspaceId = requireUuidV4(row.goal_workspace_id);
  requireExpected(goalWorkspaceId, project.workspaceId);
  if (expectedGoalId) {
    requireExpected(project.goalId, expectedGoalId);
  }
  return project;
}

/** Parses a task and verifies its joined parent belongs to the same workspace. */
function parseTask(
  row: TaskRow,
  expectedWorkspaceId?: string,
  expectedProjectId?: string,
  expectedId?: string,
): Task {
  const task: Task = {
    ...parseGoal(row, expectedWorkspaceId, expectedId),
    projectId: requireUuidV4(row.project_id),
    status: requireStatus(row.status),
  };
  const projectWorkspaceId = requireUuidV4(row.project_workspace_id);
  requireExpected(projectWorkspaceId, task.workspaceId);
  if (expectedProjectId) {
    requireExpected(task.projectId, expectedProjectId);
  }
  return task;
}

/** Parses one unified-search row into its entity-specific public candidate. */
function parseSearchCandidate(
  row: SearchRow,
  expectedWorkspaceId: string,
): PlanningSearchCandidate {
  const base = parseGoal(row, expectedWorkspaceId);
  const entityType = requireEntityType(row.entity_type);
  if (entityType === 'goal') {
    if (row.parent_id !== null || row.status !== null) {
      return invalidRow();
    }
    return { entityType, ...base };
  }

  const parentId = requireUuidV4(row.parent_id);
  if (entityType === 'project') {
    if (row.status !== null) {
      return invalidRow();
    }
    return { entityType, ...base, parentId };
  }
  return {
    entityType,
    ...base,
    parentId,
    status: requireStatus(row.status),
  };
}

/** Reuses row parsing to validate a goal before persistence. */
function validateGoal(goal: Goal): Goal {
  return parseGoal({
    id: goal.id,
    workspace_id: goal.workspaceId,
    title: goal.title,
    created_at: goal.createdAt,
  });
}

/** Reuses joined-row invariants to validate a project before persistence. */
function validateProject(project: Project): Project {
  return parseProject({
    id: project.id,
    workspace_id: project.workspaceId,
    goal_id: project.goalId,
    goal_workspace_id: project.workspaceId,
    title: project.title,
    created_at: project.createdAt,
  });
}

/** Reuses joined-row invariants to validate a task before persistence. */
function validateTask(task: Task): Task {
  return parseTask({
    id: task.id,
    workspace_id: task.workspaceId,
    project_id: task.projectId,
    project_workspace_id: task.workspaceId,
    title: task.title,
    status: task.status,
    created_at: task.createdAt,
  });
}

/** Accepts zero or one row and fails closed on duplicate durable identities. */
function oneOrUndefined<Row>(rows: Row[]): Row | undefined {
  if (rows.length > 1) {
    invalidRow();
  }
  return rows[0];
}

/** Durable PostgreSQL adapter with parameterized tenant-scoped operations. */
export class PostgresPlanningRepository implements PlanningRepository {
  /** Creates a repository over the supplied parameterized SQL client. */
  constructor(private readonly client: PlanningSqlClient) {}

  /** Inserts one validated goal using separately bound values. */
  async saveGoal(goal: Goal): Promise<void> {
    const safe = validateGoal(goal);
    await this.client.query(
      `INSERT INTO planning.goals
        (id, workspace_id, title, created_at)
       VALUES ($1, $2, $3, $4)`,
      [safe.id, safe.workspaceId, safe.title, safe.createdAt],
    );
  }

  /** Inserts one validated project using separately bound values. */
  async saveProject(project: Project): Promise<void> {
    const safe = validateProject(project);
    await this.client.query(
      `INSERT INTO planning.projects
        (id, workspace_id, goal_id, title, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [safe.id, safe.workspaceId, safe.goalId, safe.title, safe.createdAt],
    );
  }

  /** Inserts one validated task using separately bound values. */
  async saveTask(task: Task): Promise<void> {
    const safe = validateTask(task);
    await this.client.query(
      `INSERT INTO planning.tasks
        (id, workspace_id, project_id, title, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        safe.id,
        safe.workspaceId,
        safe.projectId,
        safe.title,
        safe.status,
        safe.createdAt,
      ],
    );
  }

  /** Finds at most one goal in the requested workspace. */
  async findGoal(workspaceId: string, id: string): Promise<Goal | undefined> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeId = requireUuidV4(id);
    const result = await this.client.query<GoalRow>(
      `SELECT id, workspace_id, title, created_at
       FROM planning.goals
       WHERE workspace_id = $1 AND id = $2
       LIMIT 2`,
      [safeWorkspaceId, safeId],
    );
    const row = oneOrUndefined(result.rows);
    return row ? parseGoal(row, safeWorkspaceId, safeId) : undefined;
  }

  /** Finds at most one project and verifies its joined goal ownership. */
  async findProject(
    workspaceId: string,
    id: string,
  ): Promise<Project | undefined> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeId = requireUuidV4(id);
    const result = await this.client.query<ProjectRow>(
      `SELECT
         projects.id,
         projects.workspace_id,
         projects.goal_id,
         goals.workspace_id AS goal_workspace_id,
         projects.title,
         projects.created_at
       FROM planning.projects
       JOIN planning.goals
         ON planning.goals.id = planning.projects.goal_id
        AND planning.goals.workspace_id = planning.projects.workspace_id
       WHERE planning.projects.workspace_id = $1
         AND planning.projects.id = $2
       LIMIT 2`,
      [safeWorkspaceId, safeId],
    );
    const row = oneOrUndefined(result.rows);
    return row
      ? parseProject(row, safeWorkspaceId, undefined, safeId)
      : undefined;
  }

  /** Lists goals in stable creation and opaque-identifier order. */
  async listGoals(workspaceId: string): Promise<Goal[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const result = await this.client.query<GoalRow>(
      `SELECT id, workspace_id, title, created_at
       FROM planning.goals
       WHERE workspace_id = $1
       ORDER BY created_at ASC, id ASC`,
      [safeWorkspaceId],
    );
    return result.rows.map((row) => parseGoal(row, safeWorkspaceId));
  }

  /** Lists projects below one workspace-owned goal in stable order. */
  async listProjects(workspaceId: string, goalId: string): Promise<Project[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeGoalId = requireUuidV4(goalId);
    const result = await this.client.query<ProjectRow>(
      `SELECT
         projects.id,
         projects.workspace_id,
         projects.goal_id,
         goals.workspace_id AS goal_workspace_id,
         projects.title,
         projects.created_at
       FROM planning.projects
       JOIN planning.goals
         ON planning.goals.id = planning.projects.goal_id
        AND planning.goals.workspace_id = planning.projects.workspace_id
       WHERE planning.projects.workspace_id = $1
         AND planning.projects.goal_id = $2
       ORDER BY planning.projects.created_at ASC, planning.projects.id ASC`,
      [safeWorkspaceId, safeGoalId],
    );
    return result.rows.map((row) =>
      parseProject(row, safeWorkspaceId, safeGoalId),
    );
  }

  /** Lists tasks below one workspace-owned project in stable order. */
  async listTasks(workspaceId: string, projectId: string): Promise<Task[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeProjectId = requireUuidV4(projectId);
    const result = await this.client.query<TaskRow>(
      `SELECT
         tasks.id,
         tasks.workspace_id,
         tasks.project_id,
         projects.workspace_id AS project_workspace_id,
         tasks.title,
         tasks.status,
         tasks.created_at
       FROM planning.tasks
       JOIN planning.projects
         ON planning.projects.id = planning.tasks.project_id
        AND planning.projects.workspace_id = planning.tasks.workspace_id
       WHERE planning.tasks.workspace_id = $1
         AND planning.tasks.project_id = $2
       ORDER BY planning.tasks.created_at ASC, planning.tasks.id ASC`,
      [safeWorkspaceId, safeProjectId],
    );
    return result.rows.map((row) =>
      parseTask(row, safeWorkspaceId, safeProjectId),
    );
  }

  /** Returns a bounded candidate set for deterministic application ranking. */
  async searchCandidates(
    workspaceId: string,
    input: PlanningSearchInput,
  ): Promise<PlanningSearchCandidate[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const prefixPattern = `${escapeLikePattern(input.normalizedQuery)} %`;
    const result = await this.client.query<SearchRow>(
      `SELECT entity_type, id, workspace_id, parent_id, title, status, created_at
       FROM (
         (SELECT 'goal'::text AS entity_type, id, workspace_id,
                 NULL::uuid AS parent_id, title, NULL::text AS status, created_at,
                 CASE
                   WHEN ${NORMALIZED_TITLE_SQL} = $2 THEN 0
                   WHEN ${NORMALIZED_TITLE_SQL} LIKE $3 ESCAPE E'\\\\' THEN 1
                   ELSE 2
                 END AS match_rank
          FROM planning.goals
          WHERE workspace_id = $1
            AND (
              ${NORMALIZED_TITLE_SQL} = $2
              OR ${NORMALIZED_TITLE_SQL} LIKE $3 ESCAPE E'\\\\'
              OR to_tsvector('simple', ${NORMALIZED_TITLE_SQL})
                 @@ plainto_tsquery('simple', $2)
            )
          ORDER BY match_rank ASC, created_at DESC, id ASC
          LIMIT $4)
         UNION ALL
         (SELECT 'project'::text AS entity_type, id, workspace_id,
                 goal_id AS parent_id, title, NULL::text AS status, created_at,
                 CASE
                   WHEN ${NORMALIZED_TITLE_SQL} = $2 THEN 0
                   WHEN ${NORMALIZED_TITLE_SQL} LIKE $3 ESCAPE E'\\\\' THEN 1
                   ELSE 2
                 END AS match_rank
          FROM planning.projects
          WHERE workspace_id = $1
            AND (
              ${NORMALIZED_TITLE_SQL} = $2
              OR ${NORMALIZED_TITLE_SQL} LIKE $3 ESCAPE E'\\\\'
              OR to_tsvector('simple', ${NORMALIZED_TITLE_SQL})
                 @@ plainto_tsquery('simple', $2)
            )
          ORDER BY match_rank ASC, created_at DESC, id ASC
          LIMIT $4)
         UNION ALL
         (SELECT 'task'::text AS entity_type, id, workspace_id,
                 project_id AS parent_id, title, status, created_at,
                 CASE
                   WHEN ${NORMALIZED_TITLE_SQL} = $2 THEN 0
                   WHEN ${NORMALIZED_TITLE_SQL} LIKE $3 ESCAPE E'\\\\' THEN 1
                   ELSE 2
                 END AS match_rank
          FROM planning.tasks
          WHERE workspace_id = $1
            AND (
              ${NORMALIZED_TITLE_SQL} = $2
              OR ${NORMALIZED_TITLE_SQL} LIKE $3 ESCAPE E'\\\\'
              OR to_tsvector('simple', ${NORMALIZED_TITLE_SQL})
                 @@ plainto_tsquery('simple', $2)
            )
          ORDER BY match_rank ASC, created_at DESC, id ASC
          LIMIT $4)
       ) AS candidates
       ORDER BY match_rank ASC,
                CASE entity_type WHEN 'goal' THEN 0 WHEN 'project' THEN 1 ELSE 2 END,
                created_at DESC,
                id ASC
       LIMIT $4`,
      [safeWorkspaceId, input.normalizedQuery, prefixPattern, input.limit],
    );
    return result.rows.map((row) => parseSearchCandidate(row, safeWorkspaceId));
  }
}
