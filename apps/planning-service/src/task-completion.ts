import { randomUUID } from 'node:crypto';

/** Matches the UUIDv4 form used by Planning-owned durable identifiers. */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Accepts RFC 3339 instants returned by the service-owned timestamptz column. */
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/** Coherent state change owned by Planning for one durable task. */
export type TaskCompletionTransition =
  | { status: 'todo'; completedAt: null }
  | { status: 'done'; completedAt: string };

/** Minimal producer evidence returned after the durable transition commits. */
export interface TaskCompletionEvidence {
  workspaceId: string;
  taskId: string;
  status: 'todo' | 'done';
  /** Canonical UTC `Date.prototype.toISOString()` form, or null after reopening. */
  completedAt: string | null;
}

/** Persistence boundary that must mutate status and completion time atomically. */
export interface TaskCompletionRepository {
  /** Returns committed canonical evidence, or undefined when the scoped task does not exist. */
  transitionTaskCompletion(
    workspaceId: string,
    taskId: string,
    transition: TaskCompletionTransition,
  ): Promise<TaskCompletionEvidence | undefined>;
}

/** Generic query result used by the completion-specific PostgreSQL adapter. */
export interface TaskCompletionSqlQueryResult<Row> {
  rows: Row[];
}

/** Narrow SQL client boundary required by the completion transition. */
export interface TaskCompletionSqlClient {
  /** Executes one statement with separately bound values. */
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<TaskCompletionSqlQueryResult<Row>>;
}

/** Untrusted PostgreSQL RETURNING row before producer evidence validation. */
interface TaskCompletionRow {
  workspace_id: unknown;
  id: unknown;
  status: unknown;
  completed_at: unknown;
  previous_status: unknown;
  completion_fact_count: unknown;
}

/** Stable credential-free error for malformed completion evidence from persistence. */
export class TaskCompletionPersistenceError extends Error {
  /** Creates a non-disclosing durable evidence validation failure. */
  constructor() {
    super('Persisted task completion data is invalid');
    this.name = 'TaskCompletionPersistenceError';
  }
}

/** Rejects an invalid request identifier before a repository can observe it. */
function requireRequestUuid(value: string): string {
  if (!UUID_V4_PATTERN.test(value)) {
    throw new Error('Task completion request is invalid');
  }
  return value.toLowerCase();
}

/** Rejects malformed persistence evidence without reflecting its contents. */
function invalidPersistenceEvidence(): never {
  throw new TaskCompletionPersistenceError();
}

/** Converts arbitrary persistence failures into the credential-free boundary error. */
async function boundedPersistenceCall<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch {
    return invalidPersistenceEvidence();
  }
}

/** Requires a UUIDv4 value returned from the service-owned database. */
function requirePersistedUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidPersistenceEvidence();
  }
  return value.toLowerCase();
}

/** Converts a database completion instant into canonical UTC form. */
function requirePersistedTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return invalidPersistenceEvidence();
    }
    return value.toISOString();
  }
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    return invalidPersistenceEvidence();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return invalidPersistenceEvidence();
  }
  return parsed.toISOString();
}

/** Requires the prior durable task state needed to interpret fact creation. */
function requirePersistedPreviousStatus(value: unknown): 'todo' | 'done' {
  if (value !== 'todo' && value !== 'done') {
    return invalidPersistenceEvidence();
  }
  return value;
}

/** Requires the bounded fact cardinality emitted by the atomic completion statement. */
function requirePersistedCompletionFactCount(value: unknown): 0 | 1 {
  if (value !== 0 && value !== 1) {
    return invalidPersistenceEvidence();
  }
  return value;
}

/** Parses one returned row and proves it matches the requested durable state. */
function parseCompletionEvidence(
  row: TaskCompletionRow,
  expectedWorkspaceId: string,
  expectedTaskId: string,
  expectedTransition: TaskCompletionTransition,
): TaskCompletionEvidence {
  const workspaceId = requirePersistedUuid(row.workspace_id);
  const taskId = requirePersistedUuid(row.id);
  if (workspaceId !== expectedWorkspaceId || taskId !== expectedTaskId) {
    return invalidPersistenceEvidence();
  }

  const previousStatus = requirePersistedPreviousStatus(row.previous_status);
  const completionFactCount = requirePersistedCompletionFactCount(
    row.completion_fact_count,
  );
  const expectedCompletionFactCount =
    expectedTransition.status === 'done' && previousStatus === 'todo' ? 1 : 0;
  if (completionFactCount !== expectedCompletionFactCount) {
    return invalidPersistenceEvidence();
  }

  if (row.status === 'todo') {
    if (row.completed_at !== null || expectedTransition.status !== 'todo') {
      return invalidPersistenceEvidence();
    }
    return { workspaceId, taskId, status: 'todo', completedAt: null };
  }

  if (row.status !== 'done' || expectedTransition.status !== 'done') {
    return invalidPersistenceEvidence();
  }
  return {
    workspaceId,
    taskId,
    status: 'done',
    completedAt: requirePersistedTimestamp(row.completed_at),
  };
}

/** Snapshots repository evidence into a validated plain producer result. */
function parseRepositoryEvidence(
  evidence: TaskCompletionEvidence,
  expectedWorkspaceId: string,
  expectedTaskId: string,
  expectedTransition: TaskCompletionTransition,
): TaskCompletionEvidence {
  try {
    const workspaceId = evidence.workspaceId;
    const taskId = evidence.taskId;
    const status = evidence.status;
    const completedAt = evidence.completedAt;

    if (
      workspaceId !== expectedWorkspaceId ||
      taskId !== expectedTaskId ||
      status !== expectedTransition.status
    ) {
      return invalidPersistenceEvidence();
    }
    if (expectedTransition.status === 'todo') {
      if (completedAt !== null) {
        return invalidPersistenceEvidence();
      }
      return { workspaceId, taskId, status: 'todo', completedAt: null };
    }

    const canonicalCompletedAt = requirePersistedTimestamp(completedAt);
    if (canonicalCompletedAt !== completedAt) {
      return invalidPersistenceEvidence();
    }
    return { workspaceId, taskId, status: 'done', completedAt };
  } catch {
    return invalidPersistenceEvidence();
  }
}

/** PostgreSQL adapter that keeps task state and completion evidence in one write. */
export class PostgresTaskCompletionRepository implements TaskCompletionRepository {
  /** Creates an adapter over the Planning-owned parameterized SQL connection. */
  constructor(private readonly client: TaskCompletionSqlClient) {}

  /**
   * Performs one tenant-scoped statement that locks prior state, mutates the
   * task, and appends a completion fact only for a real todo-to-done transition.
   */
  async transitionTaskCompletion(
    workspaceId: string,
    taskId: string,
    transition: TaskCompletionTransition,
  ): Promise<TaskCompletionEvidence | undefined> {
    const safeWorkspaceId = requireRequestUuid(workspaceId);
    const safeTaskId = requireRequestUuid(taskId);
    const completionFactId = randomUUID();
    return boundedPersistenceCall(async () => {
      const result = await this.client.query<TaskCompletionRow>(
        `WITH previous AS (
           SELECT workspace_id AS previous_workspace_id,
                  id AS previous_id,
                  status AS previous_status
           FROM planning.tasks
           WHERE workspace_id = $1 AND id = $2
           FOR UPDATE
         ),
         updated AS (
           UPDATE planning.tasks
           SET status = $3,
               completed_at = CASE
                 WHEN $3 = 'done' AND status = 'done' AND completed_at IS NOT NULL
                   THEN completed_at
                 WHEN $3 = 'done' THEN GREATEST($4::timestamptz, created_at)
                 ELSE NULL
               END
           FROM previous
           WHERE planning.tasks.workspace_id = previous.previous_workspace_id
             AND planning.tasks.id = previous.previous_id
           RETURNING workspace_id, id, status, completed_at,
                     previous.previous_status AS previous_status
         ),
         completion_fact AS (
           INSERT INTO planning.task_completion_facts (
             completion_fact_id,
             workspace_id,
             task_id,
             completed_at
           )
           SELECT $5::uuid, workspace_id, id, completed_at
           FROM updated
           WHERE previous_status = 'todo'
             AND status = 'done'
             AND completed_at IS NOT NULL
           RETURNING completion_fact_id, completion_sequence
         )
         SELECT workspace_id,
                id,
                status,
                completed_at,
                previous_status,
                (SELECT count(*)::integer FROM completion_fact) AS completion_fact_count
         FROM updated`,
        [
          safeWorkspaceId,
          safeTaskId,
          transition.status,
          transition.completedAt,
          completionFactId,
        ],
      );
      if (!Array.isArray(result.rows) || result.rows.length > 1) {
        return invalidPersistenceEvidence();
      }
      const row = result.rows[0];
      return row
        ? parseCompletionEvidence(row, safeWorkspaceId, safeTaskId, transition)
        : undefined;
    });
  }
}

/** Coordinates server-owned task completion without accepting client timestamps. */
export class TaskCompletionService {
  /** Injects the repository and a deterministic clock seam for tests. */
  constructor(
    private readonly repository: TaskCompletionRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Marks a task done or reopens it while preserving one atomic durable invariant. */
  async setCompleted(
    workspaceId: string,
    taskId: string,
    completed: boolean,
  ): Promise<TaskCompletionEvidence> {
    const safeWorkspaceId = requireRequestUuid(workspaceId);
    const safeTaskId = requireRequestUuid(taskId);
    let transition: TaskCompletionTransition = {
      status: 'todo',
      completedAt: null,
    };
    if (completed) {
      const now = this.clock();
      if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new Error('Task completion request is invalid');
      }
      transition = { status: 'done', completedAt: now.toISOString() };
    }

    const evidence = await boundedPersistenceCall(() =>
      this.repository.transitionTaskCompletion(
        safeWorkspaceId,
        safeTaskId,
        transition,
      ),
    );
    if (evidence === undefined) {
      throw new Error('Task not found');
    }
    return parseRepositoryEvidence(
      evidence,
      safeWorkspaceId,
      safeTaskId,
      transition,
    );
  }
}
