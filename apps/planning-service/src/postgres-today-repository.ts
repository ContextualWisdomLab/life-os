import type {
  PlanningSqlClient,
  PlanningSqlQueryResult,
} from './postgres-planning-repository';
import {
  TodayIdempotencyConflictError,
  TodayRevisionConflictError,
  type DurableTodayAction,
  type DurableTodayAggregate,
  type DurableTodayDraft,
  type TodayRepository,
  type TodayWriteCommand,
  type TodayWriteResult,
} from './today-sync';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const RFC_3339_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const TODAY_VERSION = 'life-os.today.v1' as const;

interface TodayAggregateRow {
  workspace_id: unknown;
  local_date: unknown;
  aggregate_id: unknown;
  revision_token: unknown;
  payload_json: unknown;
}

interface TodayWriteRow {
  outcome: unknown;
  request_digest: unknown;
  aggregate_id: unknown;
  revision_token: unknown;
  payload_json: unknown;
  current_revision: unknown;
}

/** Stable failure when durable Today rows violate repository invariants. */
export class TodayPersistenceError extends Error {
  /** Creates a credential-free persistence validation failure. */
  constructor() {
    super('Persisted Today data is invalid');
    this.name = 'TodayPersistenceError';
  }
}

/** Rejects malformed persisted data without returning its contents. */
function invalidPersistence(): never {
  throw new TodayPersistenceError();
}

/** Requires a canonical UUIDv4 value from an untrusted database field. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidPersistence();
  }
  return value.toLowerCase();
}

/** Requires a canonical calendar date from an untrusted database field. */
function requireDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    return invalidPersistence();
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalidPersistence();
  }
  return value;
}

/** Requires one bounded title from persisted JSON. */
function requireTitle(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value.trim()].length > 160 ||
    Buffer.byteLength(value.trim(), 'utf8') > 1024 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    return invalidPersistence();
  }
  return value.trim();
}

/** Requires a canonical UTC instant from persisted JSON. */
function requireInstant(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_UTC_PATTERN.test(value)) {
    return invalidPersistence();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return invalidPersistence();
  }
  return parsed.toISOString();
}

/** Requires one validated persisted Today action. */
function requireAction(value: unknown): DurableTodayAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidPersistence();
  }
  const row = value as Record<string, unknown>;
  const keys = [
    'id',
    'title',
    'status',
    'priority',
    'startMinute',
    'durationMinutes',
    'createdAt',
    'completedAt',
  ];
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key))
  ) {
    return invalidPersistence();
  }
  if (row.status !== 'open' && row.status !== 'done') {
    return invalidPersistence();
  }
  if (row.priority !== null && row.priority !== 1 && row.priority !== 2 && row.priority !== 3) {
    return invalidPersistence();
  }
  const startMinute = row.startMinute;
  const durationMinutes = row.durationMinutes;
  if (
    startMinute !== null &&
    (!Number.isSafeInteger(startMinute) ||
      (startMinute as number) < 0 ||
      (startMinute as number) >= 1440 ||
      (startMinute as number) % 15 !== 0)
  ) {
    return invalidPersistence();
  }
  if (
    durationMinutes !== null &&
    (!Number.isSafeInteger(durationMinutes) ||
      (durationMinutes as number) < 15 ||
      (durationMinutes as number) > 240 ||
      (durationMinutes as number) % 15 !== 0)
  ) {
    return invalidPersistence();
  }
  if ((startMinute === null) !== (durationMinutes === null)) {
    return invalidPersistence();
  }
  if (
    startMinute !== null &&
    durationMinutes !== null &&
    (startMinute as number) + (durationMinutes as number) > 1440
  ) {
    return invalidPersistence();
  }
  const completedAt =
    row.completedAt === null ? null : requireInstant(row.completedAt);
  if (
    (row.status === 'done' && completedAt === null) ||
    (row.status === 'open' && completedAt !== null)
  ) {
    return invalidPersistence();
  }
  return Object.freeze({
    id: requireUuid(row.id),
    title: requireTitle(row.title),
    status: row.status,
    priority: row.priority,
    startMinute: startMinute as number | null,
    durationMinutes: durationMinutes as number | null,
    createdAt: requireInstant(row.createdAt),
    completedAt,
  });
}

/** Validates persisted complete-draft JSON and its cross-field invariants. */
function requireDraft(value: unknown, expectedDate: string): DurableTodayDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalidPersistence();
  }
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 3 ||
    row.version !== TODAY_VERSION ||
    row.date !== expectedDate ||
    !Array.isArray(row.actions) ||
    row.actions.length > 50
  ) {
    return invalidPersistence();
  }
  const actions = row.actions.map(requireAction);
  const ids = new Set<string>();
  const priorities = new Set<number>();
  for (const action of actions) {
    if (ids.has(action.id)) return invalidPersistence();
    ids.add(action.id);
    if (action.priority !== null) {
      if (priorities.has(action.priority)) return invalidPersistence();
      priorities.add(action.priority);
    }
  }
  const scheduled = actions
    .filter(
      (action) =>
        action.status === 'open' &&
        action.startMinute !== null &&
        action.durationMinutes !== null,
    )
    .sort(
      (left, right) =>
        (left.startMinute ?? 0) - (right.startMinute ?? 0) ||
        left.id.localeCompare(right.id),
    );
  for (let index = 1; index < scheduled.length; index += 1) {
    const previous = scheduled[index - 1];
    const current = scheduled[index];
    if (
      previous &&
      current &&
      (previous.startMinute ?? 0) + (previous.durationMinutes ?? 0) >
        (current.startMinute ?? 0)
    ) {
      return invalidPersistence();
    }
  }
  return Object.freeze({
    version: TODAY_VERSION,
    date: expectedDate,
    actions: Object.freeze(actions),
  });
}

/** Parses a persistence row into the public aggregate while enforcing ownership. */
function parseAggregateRow(
  row: TodayAggregateRow,
  expectedWorkspaceId: string,
  expectedDate: string,
): DurableTodayAggregate {
  const workspaceId = requireUuid(row.workspace_id);
  if (workspaceId !== expectedWorkspaceId.toLowerCase()) {
    return invalidPersistence();
  }
  const date = requireDate(row.local_date);
  if (date !== expectedDate) {
    return invalidPersistence();
  }
  const draft = requireDraft(row.payload_json, expectedDate);
  return Object.freeze({
    ...draft,
    aggregateId: requireUuid(row.aggregate_id),
    revision: requireUuid(row.revision_token),
  });
}

/** Accepts at most one durable row for a unique workspace/date lookup. */
function oneOrUndefined<Row>(rows: Row[]): Row | undefined {
  if (rows.length > 1) return invalidPersistence();
  return rows[0];
}

/** Requires a single write-result row from the atomic persistence statement. */
function exactlyOne<Row>(result: PlanningSqlQueryResult<Row>): Row {
  if (result.rows.length !== 1 || !result.rows[0]) {
    return invalidPersistence();
  }
  return result.rows[0];
}

/** Requires a stored request digest without accepting arbitrary text. */
function requireDigest(value: unknown): string {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    return invalidPersistence();
  }
  return value;
}

/** PostgreSQL adapter for atomic, tenant-scoped durable Today synchronization. */
export class PostgresTodayRepository implements TodayRepository {
  /** Creates the adapter over the planning-service parameterized SQL client. */
  constructor(private readonly client: PlanningSqlClient) {}

  /** Reads at most one aggregate from exactly one workspace and local date. */
  async getToday(
    workspaceId: string,
    date: string,
  ): Promise<DurableTodayAggregate | undefined> {
    const result = await this.client.query<TodayAggregateRow>(
      `SELECT workspace_id, local_date, aggregate_id, revision_token, payload_json
       FROM planning.today_aggregates
       WHERE workspace_id = $1 AND local_date = $2
       LIMIT 2`,
      [workspaceId, date],
    );
    const row = oneOrUndefined(result.rows);
    return row ? parseAggregateRow(row, workspaceId, date) : undefined;
  }

  /**
   * Serializes each workspace/date and idempotency key with transaction-scoped
   * advisory locks, then performs replay detection and create/update atomically.
   */
  async writeToday(command: TodayWriteCommand): Promise<TodayWriteResult> {
    const result = await this.client.query<TodayWriteRow>(
      `WITH locks AS MATERIALIZED (
         SELECT
           pg_advisory_xact_lock(hashtextextended($1::text || ':' || $2::text, 0)) AS aggregate_lock,
           pg_advisory_xact_lock(hashtextextended($1::text || ':' || $3::text, 1)) AS idempotency_lock
       ),
       existing_replay AS MATERIALIZED (
         SELECT request_digest, result_kind, aggregate_id, revision_token, payload_json
         FROM planning.today_idempotency_records, locks
         WHERE workspace_id = $1 AND idempotency_key = $3
       ),
       current_aggregate AS MATERIALIZED (
         SELECT aggregate_id, revision_token
         FROM planning.today_aggregates, locks
         WHERE workspace_id = $1 AND local_date = $2
       ),
       updated AS (
         UPDATE planning.today_aggregates
         SET revision_number = revision_number + 1,
             revision_token = $6,
             payload_json = $7::jsonb,
             updated_at = clock_timestamp()
         WHERE workspace_id = $1
           AND local_date = $2
           AND $8 = 'match'
           AND revision_token = $9
           AND NOT EXISTS (SELECT 1 FROM existing_replay)
         RETURNING 'updated'::text AS result_kind,
                   aggregate_id, revision_token, payload_json
       ),
       created AS (
         INSERT INTO planning.today_aggregates
           (workspace_id, local_date, aggregate_id, revision_number,
            revision_token, payload_json, created_at, updated_at)
         SELECT $1, $2, $5, 1, $6, $7::jsonb,
                clock_timestamp(), clock_timestamp()
         FROM locks
         WHERE $8 = 'absent'
           AND NOT EXISTS (SELECT 1 FROM existing_replay)
           AND NOT EXISTS (SELECT 1 FROM current_aggregate)
         ON CONFLICT (workspace_id, local_date) DO NOTHING
         RETURNING 'created'::text AS result_kind,
                   aggregate_id, revision_token, payload_json
       ),
       mutation AS MATERIALIZED (
         SELECT * FROM updated
         UNION ALL
         SELECT * FROM created
       ),
       stored_replay AS (
         INSERT INTO planning.today_idempotency_records
           (workspace_id, idempotency_key, request_digest, result_kind,
            aggregate_id, revision_token, payload_json, created_at)
         SELECT $1, $3, $4, result_kind,
                aggregate_id, revision_token, payload_json, clock_timestamp()
         FROM mutation
         ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
         RETURNING request_digest, result_kind, aggregate_id, revision_token, payload_json
       )
       SELECT
         CASE
           WHEN replay.request_digest IS NOT NULL AND replay.request_digest <> $4
             THEN 'idempotency_conflict'
           WHEN replay.request_digest IS NOT NULL THEN 'replayed'
           WHEN mutation.result_kind IS NOT NULL THEN mutation.result_kind
           ELSE 'revision_conflict'
         END AS outcome,
         COALESCE(replay.request_digest, stored.request_digest, $4) AS request_digest,
         COALESCE(replay.aggregate_id, mutation.aggregate_id, stored.aggregate_id) AS aggregate_id,
         COALESCE(replay.revision_token, mutation.revision_token, stored.revision_token) AS revision_token,
         COALESCE(replay.payload_json, mutation.payload_json, stored.payload_json) AS payload_json,
         current_aggregate.revision_token AS current_revision
       FROM locks
       LEFT JOIN existing_replay AS replay ON TRUE
       LEFT JOIN mutation ON TRUE
       LEFT JOIN stored_replay AS stored ON TRUE
       LEFT JOIN current_aggregate ON TRUE
       LIMIT 1`,
      [
        command.workspaceId,
        command.draft.date,
        command.idempotencyKey,
        command.requestDigest,
        command.newAggregateId,
        command.newRevision,
        JSON.stringify(command.draft),
        command.precondition.kind,
        command.precondition.kind === 'match'
          ? command.precondition.revision
          : null,
      ],
    );
    const row = exactlyOne(result);
    const requestDigest = requireDigest(row.request_digest);
    if (row.outcome === 'idempotency_conflict' || requestDigest !== command.requestDigest) {
      throw new TodayIdempotencyConflictError();
    }
    if (row.outcome === 'revision_conflict') {
      const currentRevision =
        row.current_revision === null ? null : requireUuid(row.current_revision);
      throw new TodayRevisionConflictError(currentRevision);
    }
    if (
      row.outcome !== 'created' &&
      row.outcome !== 'updated' &&
      row.outcome !== 'replayed'
    ) {
      return invalidPersistence();
    }
    const aggregate = parseAggregateRow(
      {
        workspace_id: command.workspaceId,
        local_date: command.draft.date,
        aggregate_id: row.aggregate_id,
        revision_token: row.revision_token,
        payload_json: row.payload_json,
      },
      command.workspaceId,
      command.draft.date,
    );
    return {
      kind: row.outcome,
      aggregate,
    };
  }
}
