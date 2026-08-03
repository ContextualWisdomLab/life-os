import {
  ReviewCompletionConflictError,
  type ReviewCompletionRecord,
  type ReviewRepository,
  ReviewValidationError,
  validateReviewCompletionRecord,
} from './review-domain';

/** Minimal parameterized SQL result boundary for review persistence. */
export interface ReviewSqlQueryResult<Row> {
  rows: Row[];
}

/** Minimal parameterized SQL client boundary for review persistence. */
export interface ReviewSqlClient {
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ReviewSqlQueryResult<Row>>;
}

interface ReviewCompletionRow {
  id: unknown;
  workspace_id: unknown;
  ritual_kind: unknown;
  period_start_date: unknown;
  idempotency_key: unknown;
  completed_step_count: unknown;
  total_step_count: unknown;
  planned_item_count: unknown;
  completed_item_count: unknown;
  habit_completion_count: unknown;
  reflection_text: unknown;
  completed_at: unknown;
  payload_digest: unknown;
  recorded_at: unknown;
}

/** Credential-free failure for malformed rows and database errors. */
export class ReviewPersistenceError extends Error {
  constructor() {
    super('Review persistence operation failed');
    this.name = 'ReviewPersistenceError';
  }
}

function persistenceFailure(): never {
  throw new ReviewPersistenceError();
}

function parseInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return persistenceFailure();
}

function parseTimestamp(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return persistenceFailure();
}

function parseLocalDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  return persistenceFailure();
}

function parseRow(
  row: ReviewCompletionRow,
  expectedWorkspaceId?: string,
): ReviewCompletionRecord {
  try {
    const record = validateReviewCompletionRecord({
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      ritualKind: row.ritual_kind as ReviewCompletionRecord['ritualKind'],
      periodStartDate: parseLocalDate(row.period_start_date),
      idempotencyKey: row.idempotency_key as string,
      completedStepCount: parseInteger(row.completed_step_count),
      totalStepCount: parseInteger(row.total_step_count),
      plannedItemCount: parseInteger(row.planned_item_count),
      completedItemCount: parseInteger(row.completed_item_count),
      habitCompletionCount: parseInteger(row.habit_completion_count),
      ...(row.reflection_text === null || row.reflection_text === undefined
        ? {}
        : { reflection: row.reflection_text as string }),
      completedAt: parseTimestamp(row.completed_at),
      payloadDigest: row.payload_digest as string,
      recordedAt: parseTimestamp(row.recorded_at),
    });
    if (
      expectedWorkspaceId !== undefined &&
      record.workspaceId !== expectedWorkspaceId.toLowerCase()
    ) {
      persistenceFailure();
    }
    return record;
  } catch (error) {
    if (error instanceof ReviewValidationError) return persistenceFailure();
    throw error;
  }
}

function exactlyOne<Row>(rows: Row[]): Row {
  if (rows.length !== 1) return persistenceFailure();
  const row = rows[0];
  if (row === undefined) return persistenceFailure();
  return row;
}

function sameImmutableEvidence(
  persisted: ReviewCompletionRecord,
  attempted: ReviewCompletionRecord,
): boolean {
  return (
    persisted.workspaceId === attempted.workspaceId &&
    persisted.ritualKind === attempted.ritualKind &&
    persisted.periodStartDate === attempted.periodStartDate &&
    persisted.idempotencyKey === attempted.idempotencyKey &&
    persisted.payloadDigest === attempted.payloadDigest
  );
}

/** Parameterized, tenant-scoped PostgreSQL guided-review repository. */
export class PostgresReviewRepository implements ReviewRepository {
  constructor(private readonly client: ReviewSqlClient) {}

  private async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ReviewSqlQueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      throw new ReviewPersistenceError();
    }
  }

  async record(
    completion: ReviewCompletionRecord,
  ): Promise<ReviewCompletionRecord> {
    let safe: ReviewCompletionRecord;
    try {
      safe = validateReviewCompletionRecord(completion);
    } catch (error) {
      if (error instanceof ReviewValidationError) {
        throw new ReviewPersistenceError();
      }
      throw error;
    }

    const inserted = await this.query<ReviewCompletionRow>(
      `INSERT INTO guided_review.review_completions
        (id, workspace_id, ritual_kind, period_start_date, idempotency_key,
         completed_step_count, total_step_count, planned_item_count,
         completed_item_count, habit_completion_count, reflection_text,
         completed_at, payload_digest, recorded_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT DO NOTHING
       RETURNING id, workspace_id, ritual_kind, period_start_date,
         idempotency_key, completed_step_count, total_step_count,
         planned_item_count, completed_item_count, habit_completion_count,
         reflection_text, completed_at, payload_digest, recorded_at`,
      [
        safe.id,
        safe.workspaceId,
        safe.ritualKind,
        safe.periodStartDate,
        safe.idempotencyKey,
        safe.completedStepCount,
        safe.totalStepCount,
        safe.plannedItemCount,
        safe.completedItemCount,
        safe.habitCompletionCount,
        safe.reflection ?? null,
        safe.completedAt,
        safe.payloadDigest,
        safe.recordedAt,
      ],
    );
    if (inserted.rows.length === 1) {
      return parseRow(exactlyOne(inserted.rows), safe.workspaceId);
    }
    if (inserted.rows.length > 1) persistenceFailure();

    const conflicts = await this.query<ReviewCompletionRow>(
      `SELECT id, workspace_id, ritual_kind, period_start_date,
         idempotency_key, completed_step_count, total_step_count,
         planned_item_count, completed_item_count, habit_completion_count,
         reflection_text, completed_at, payload_digest, recorded_at
       FROM guided_review.review_completions
       WHERE workspace_id = $1
         AND (
           idempotency_key = $2
           OR (ritual_kind = $3 AND period_start_date = $4)
         )
       ORDER BY recorded_at ASC, id ASC
       LIMIT 3`,
      [
        safe.workspaceId,
        safe.idempotencyKey,
        safe.ritualKind,
        safe.periodStartDate,
      ],
    );
    const persisted = parseRow(exactlyOne(conflicts.rows), safe.workspaceId);
    if (!sameImmutableEvidence(persisted, safe)) {
      throw new ReviewCompletionConflictError();
    }
    return persisted;
  }

  async list(
    workspaceId: string,
    limit: number,
  ): Promise<ReviewCompletionRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new ReviewPersistenceError();
    }
    const result = await this.query<ReviewCompletionRow>(
      `SELECT id, workspace_id, ritual_kind, period_start_date,
         idempotency_key, completed_step_count, total_step_count,
         planned_item_count, completed_item_count, habit_completion_count,
         reflection_text, completed_at, payload_digest, recorded_at
       FROM guided_review.review_completions
       WHERE workspace_id = $1
       ORDER BY completed_at DESC, recorded_at DESC, id DESC
       LIMIT $2`,
      [workspaceId.toLowerCase(), limit],
    );
    return result.rows.map((row) => parseRow(row, workspaceId));
  }
}
