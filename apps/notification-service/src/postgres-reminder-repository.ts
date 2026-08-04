import { createHash, randomUUID } from 'node:crypto';
import {
  MAX_DAILY_REMINDERS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_REMINDER_BATCH_SIZE,
  /** Represents the bounded reminder delivery values accepted by the notification service. */
  type ReminderDelivery,
  /** Represents the bounded reminder delivery gateway values accepted by the notification service. */
  type ReminderDeliveryGateway,
  /** Represents the bounded reminder occurrence values accepted by the notification service. */
  type ReminderOccurrence,
  /** Represents the bounded reminder repository values accepted by the notification service. */
  type ReminderRepository,
  validateReminderOccurrence,
} from './reminder-scheduler';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAXIMUM_IDEMPOTENCY_KEY_BYTES = 1_024;
const MAXIMUM_QUERY_LIMIT = 100;
const MINIMUM_CLAIM_LEASE_SECONDS = 30;
const MAXIMUM_CLAIM_LEASE_SECONDS = 3_600;

/** Minimal query result returned by a notification SQL client. */
export interface NotificationSqlQueryResult<Row> {
  readonly rows: Row[];
}

/** Parameterized SQL boundary used by the PostgreSQL notification adapters. */
export interface NotificationSqlClient {
  /** Executes one parameterized PostgreSQL statement and maps transport failures to a credential-free service error. */
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>>;
}

/** Durable reminder record returned by tenant-scoped service reads. */
export interface PersistedReminderOccurrence extends ReminderOccurrence {
  readonly status: 'pending' | 'delivered' | 'failed';
  readonly claimExpiresAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Immutable scheduler outcome returned by tenant-scoped service reads. */
export interface ReminderOutcome {
  readonly id: string;
  readonly workspaceId: string;
  readonly reminderId: string;
  readonly kind: 'delivered' | 'deferred' | 'failed';
  readonly occurredAt: string;
  readonly nextAttemptAt: string | null;
  readonly reason:
    'quiet_hours' | 'daily_limit' | 'delivery_failed' | 'attempt_limit' | null;
  readonly deliveryLocalDate: string | null;
  readonly createdAt: string;
}

/** Durable in-app notification returned by tenant-scoped service reads. */
export interface InboxMessage {
  readonly id: string;
  readonly workspaceId: string;
  readonly reminderId: string;
  readonly title: string;
  readonly dueAt: string;
  readonly timeZone: string;
  readonly deliveredAt: string;
  readonly readAt: string | null;
  readonly createdAt: string;
}

/** Describes the untrusted PostgreSQL reminder row validated before domain use. */
interface ReminderRow {
  reminder_id: unknown;
  workspace_id: unknown;
  reminder_title: unknown;
  due_instant: unknown;
  time_zone: unknown;
  quiet_start_minute: unknown;
  quiet_end_minute: unknown;
  daily_delivery_limit: unknown;
  delivery_attempt_count: unknown;
  occurrence_status: unknown;
  claim_expires_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

/** Describes the untrusted PostgreSQL outcome row validated before domain use. */
interface OutcomeRow {
  outcome_id: unknown;
  workspace_id: unknown;
  reminder_id: unknown;
  outcome_kind: unknown;
  occurred_at: unknown;
  next_attempt_at: unknown;
  outcome_reason: unknown;
  delivery_local_date: unknown;
  created_at: unknown;
}

/** Describes the untrusted PostgreSQL inbox row validated before domain use. */
interface InboxRow {
  message_id: unknown;
  workspace_id: unknown;
  reminder_id: unknown;
  message_title: unknown;
  due_instant: unknown;
  time_zone: unknown;
  delivered_at: unknown;
  read_at: unknown;
  created_at: unknown;
}

/** Describes the untrusted PostgreSQL count row validated before domain use. */
interface CountRow {
  delivery_count: unknown;
}

/** Describes the untrusted PostgreSQL identifier row validated before domain use. */
interface IdentifierRow {
  reminder_id: unknown;
}

/** Describes the untrusted PostgreSQL transition row validated before domain use. */
interface TransitionRow {
  transitioned: unknown;
  outcome_inserted: unknown;
}

/** Safe public failure for invalid input, malformed rows, and SQL failures. */
export class NotificationPersistenceError extends Error {
  /** Creates the component with validated dependencies and bounded configuration. */
  constructor() {
    super('Notification persistence operation failed');
    this.name = 'NotificationPersistenceError';
  }
}

/** Signals that an idempotent identifier was reused with another payload. */
export class NotificationReplayConflictError extends Error {
  /** Creates the component with validated dependencies and bounded configuration. */
  constructor() {
    super('Notification replay conflicts with the persisted payload');
    this.name = 'NotificationReplayConflictError';
  }
}

/** Raises the stable credential-free persistence error used at every fail-closed boundary. */
function persistenceFailure(): never {
  throw new NotificationPersistenceError();
}

/** Validates and canonicalizes an untrusted UUIDv4 identifier before it reaches SQL. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return persistenceFailure();
  }
  return value.toLowerCase();
}

/** Rejects a returned identifier when it does not match the tenant-scoped value requested by the caller. */
function requireExpectedUuid(actual: string, expected: string): void {
  if (actual !== requireUuid(expected)) {
    /** Performs the persistence failure operation while preserving tenant-safe bounded behavior. */
    persistenceFailure();
  }
}

/** Validates an RFC 3339 timestamp or PostgreSQL Date value and returns canonical UTC text. */
function requireTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return persistenceFailure();
    }
    return value.toISOString();
  }
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    return persistenceFailure();
  }
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return persistenceFailure();
  }
  return candidate.toISOString();
}

/** Validates an optional timestamp while preserving an explicit null value. */
function requireNullableTimestamp(value: unknown): string | null {
  return value === null ? null : requireTimestamp(value);
}

/** Validates a real Gregorian calendar date in YYYY-MM-DD form. */
function requireLocalDate(value: unknown): string {
  const candidate =
    value instanceof Date
      ? [
          /** Performs the string operation while preserving tenant-safe bounded behavior. */
          String(value.getFullYear()).padStart(4, '0'),
          /** Performs the string operation while preserving tenant-safe bounded behavior. */
          String(value.getMonth() + 1).padStart(2, '0'),
          /** Performs the string operation while preserving tenant-safe bounded behavior. */
          String(value.getDate()).padStart(2, '0'),
        ].join('-')
      : value;
  if (typeof candidate !== 'string' || !LOCAL_DATE_PATTERN.test(candidate)) {
    return persistenceFailure();
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== candidate
  ) {
    return persistenceFailure();
  }
  return candidate;
}

/** Validates an optional local calendar date while preserving null. */
function requireNullableLocalDate(value: unknown): string | null {
  return value === null ? null : requireLocalDate(value);
}

/** Validates an integer against an explicit inclusive safety range. */
function requireInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  const candidate = typeof value === 'string' ? Number(value) : value;
  if (
    typeof candidate !== 'number' ||
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    return persistenceFailure();
  }
  return candidate;
}

/** Validates a caller-supplied result limit against the repository-wide maximum. */
function requireLimit(value: number): number {
  return requireInteger(value, 1, MAXIMUM_QUERY_LIMIT);
}

/** Converts untrusted reminder data into the validated scheduler domain shape or fails closed. */
function safeReminderOccurrence(value: unknown): ReminderOccurrence {
  try {
    return validateReminderOccurrence(value);
  } catch {
    return persistenceFailure();
  }
}

/** Returns the exact SHA-256 bytes for a bounded opaque idempotency key. */
export function hashNotificationIdempotencyKey(value: unknown): Buffer {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > MAXIMUM_IDEMPOTENCY_KEY_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return persistenceFailure();
  }
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Requires a SQL operation to return exactly one row before any row is trusted. */
function exactlyOne<Row>(rows: readonly Row[]): Row {
  if (rows.length !== 1) {
    return persistenceFailure();
  }
  return rows[0] as Row;
}

/** Requires a conditional SQL operation to return at most one row. */
function zeroOrOne<Row>(rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) {
    return persistenceFailure();
  }
  return rows[0];
}

/** Validates the scheduler fields of an untrusted PostgreSQL reminder row. */
function baseReminderFromRow(row: ReminderRow): ReminderOccurrence {
  const quietStart =
    row.quiet_start_minute === null
      ? null
      : requireInteger(row.quiet_start_minute, 0, 1_439);
  const quietEnd =
    row.quiet_end_minute === null
      ? null
      : requireInteger(row.quiet_end_minute, 0, 1_439);
  if ((quietStart === null) !== (quietEnd === null)) {
    return persistenceFailure();
  }
  return safeReminderOccurrence({
    id: requireUuid(row.reminder_id),
    workspaceId: requireUuid(row.workspace_id),
    title: row.reminder_title,
    dueAt: requireTimestamp(row.due_instant),
    timeZone: row.time_zone,
    quietHours:
      quietStart === null
        ? null
        : { startMinute: quietStart, endMinute: quietEnd as number },
    maxPerLocalDay: requireInteger(
      row.daily_delivery_limit,
      1,
      MAX_DAILY_REMINDERS,
    ),
    deliveryAttempt: requireInteger(
      row.delivery_attempt_count,
      0,
      MAX_DELIVERY_ATTEMPTS,
    ),
  });
}

/** Validates a complete durable reminder row and enforces optional tenant and reminder expectations. */
function parsePersistedReminder(
  row: ReminderRow,
  expectedWorkspaceId: string,
  expectedReminderId?: string,
): PersistedReminderOccurrence {
  const reminder = baseReminderFromRow(row);
  /** Performs the require expected uuid operation while preserving tenant-safe bounded behavior. */
  requireExpectedUuid(reminder.workspaceId, expectedWorkspaceId);
  if (expectedReminderId !== undefined) {
    /** Performs the require expected uuid operation while preserving tenant-safe bounded behavior. */
    requireExpectedUuid(reminder.id, expectedReminderId);
  }
  const status = row.occurrence_status;
  if (status !== 'pending' && status !== 'delivered' && status !== 'failed') {
    return persistenceFailure();
  }
  const createdAt = requireTimestamp(row.created_at);
  const updatedAt = requireTimestamp(row.updated_at);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    return persistenceFailure();
  }
  return {
    ...reminder,
    status,
    claimExpiresAt: requireNullableTimestamp(row.claim_expires_at),
    createdAt,
    updatedAt,
  };
}

/** Validates an immutable outcome row and its kind-specific invariants. */
function parseOutcome(
  row: OutcomeRow,
  expectedWorkspaceId: string,
): ReminderOutcome {
  const kind = row.outcome_kind;
  if (kind !== 'delivered' && kind !== 'deferred' && kind !== 'failed') {
    return persistenceFailure();
  }
  const reason = row.outcome_reason;
  if (
    reason !== null &&
    reason !== 'quiet_hours' &&
    reason !== 'daily_limit' &&
    reason !== 'delivery_failed' &&
    reason !== 'attempt_limit'
  ) {
    return persistenceFailure();
  }
  const outcome: ReminderOutcome = {
    id: requireUuid(row.outcome_id),
    workspaceId: requireUuid(row.workspace_id),
    reminderId: requireUuid(row.reminder_id),
    kind,
    occurredAt: requireTimestamp(row.occurred_at),
    nextAttemptAt: requireNullableTimestamp(row.next_attempt_at),
    reason,
    deliveryLocalDate: requireNullableLocalDate(row.delivery_local_date),
    createdAt: requireTimestamp(row.created_at),
  };
  /** Rejects a returned identifier when it does not match the tenant-scoped value requested by the caller. */
  requireExpectedUuid(outcome.workspaceId, expectedWorkspaceId);
  if (
    (outcome.kind === 'delivered' &&
      (outcome.reason !== null ||
        outcome.nextAttemptAt !== null ||
        outcome.deliveryLocalDate === null)) ||
    (outcome.kind === 'deferred' &&
      (outcome.nextAttemptAt === null ||
        (outcome.reason !== 'quiet_hours' &&
          outcome.reason !== 'daily_limit') ||
        outcome.deliveryLocalDate !== null)) ||
    (outcome.kind === 'failed' &&
      (outcome.deliveryLocalDate !== null ||
        (outcome.reason === 'delivery_failed'
          ? outcome.nextAttemptAt === null
          : outcome.reason !== 'attempt_limit' ||
            outcome.nextAttemptAt !== null)))
  ) {
    return persistenceFailure();
  }
  return outcome;
}

/** Validates an inbox row, tenant ownership, and monotonic delivery/read timestamps. */
function parseInbox(row: InboxRow, expectedWorkspaceId: string): InboxMessage {
  const reminder = safeReminderOccurrence({
    id: requireUuid(row.reminder_id),
    workspaceId: requireUuid(row.workspace_id),
    title: row.message_title,
    dueAt: requireTimestamp(row.due_instant),
    timeZone: row.time_zone,
    quietHours: null,
    maxPerLocalDay: 1,
    deliveryAttempt: 0,
  });
  /** Rejects a returned identifier when it does not match the tenant-scoped value requested by the caller. */
  requireExpectedUuid(reminder.workspaceId, expectedWorkspaceId);
  const deliveredAt = requireTimestamp(row.delivered_at);
  const readAt = requireNullableTimestamp(row.read_at);
  if (readAt !== null && Date.parse(readAt) < Date.parse(deliveredAt)) {
    return persistenceFailure();
  }
  return {
    id: requireUuid(row.message_id),
    workspaceId: reminder.workspaceId,
    reminderId: reminder.id,
    title: reminder.title,
    dueAt: reminder.dueAt,
    timeZone: reminder.timeZone,
    deliveredAt,
    readAt,
    createdAt: requireTimestamp(row.created_at),
  };
}

/** Validates a delivery envelope without retaining its raw idempotency key. */
function validateDelivery(message: ReminderDelivery): ReminderDelivery {
  const reminder = safeReminderOccurrence({
    id: message.reminderId,
    workspaceId: message.workspaceId,
    title: message.title,
    dueAt: message.dueAt,
    timeZone: message.timeZone,
    quietHours: null,
    maxPerLocalDay: 1,
    deliveryAttempt: 0,
  });
  /** Returns SHA-256 bytes for a bounded opaque key without persisting the raw value. */
  hashNotificationIdempotencyKey(message.idempotencyKey);
  return {
    workspaceId: reminder.workspaceId,
    reminderId: reminder.id,
    title: reminder.title,
    dueAt: reminder.dueAt,
    timeZone: reminder.timeZone,
    idempotencyKey: message.idempotencyKey,
  };
}

/** Compares an attempted schedule with its persisted immutable replay fields. */
function scheduleMatches(
  persisted: PersistedReminderOccurrence,
  attempted: ReminderOccurrence,
): boolean {
  return (
    persisted.status === 'pending' &&
    persisted.title === attempted.title &&
    persisted.dueAt === attempted.dueAt &&
    persisted.timeZone === attempted.timeZone &&
    persisted.maxPerLocalDay === attempted.maxPerLocalDay &&
    persisted.deliveryAttempt === attempted.deliveryAttempt &&
    persisted.quietHours?.startMinute === attempted.quietHours?.startMinute &&
    persisted.quietHours?.endMinute === attempted.quietHours?.endMinute
  );
}

/** Compares an attempted delivery with the persisted inbox replay fields. */
function inboxMatches(
  persisted: InboxMessage,
  attempted: ReminderDelivery,
): boolean {
  return (
    persisted.reminderId === attempted.reminderId &&
    persisted.title === attempted.title &&
    persisted.dueAt === attempted.dueAt &&
    persisted.timeZone === attempted.timeZone
  );
}

/** Requires both the reminder state transition and immutable outcome insert to succeed atomically. */
function requireSuccessfulTransition(row: TransitionRow): void {
  if (row.transitioned !== true || row.outcome_inserted !== true) {
    /** Performs the persistence failure operation while preserving tenant-safe bounded behavior. */
    persistenceFailure();
  }
}

/** Parameterized, tenant-scoped PostgreSQL reminder repository. */
export class PostgresReminderRepository implements ReminderRepository {
  /** Creates the component with validated dependencies and bounded configuration. */
  constructor(
    private readonly client: NotificationSqlClient,
    private readonly claimLeaseSeconds = 300,
    private readonly uuidFactory: () => string = randomUUID,
    private readonly claimKeyFactory: () => string = randomUUID,
  ) {
    /** Performs the require integer operation while preserving tenant-safe bounded behavior. */
    requireInteger(
      claimLeaseSeconds,
      MINIMUM_CLAIM_LEASE_SECONDS,
      MAXIMUM_CLAIM_LEASE_SECONDS,
    );
  }

  /** Executes one parameterized PostgreSQL statement and maps transport failures to a credential-free service error. */
  private async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      throw new NotificationPersistenceError();
    }
  }

  /** Inserts one occurrence or returns an exact idempotent replay. */
  async schedule(
    occurrence: ReminderOccurrence,
  ): Promise<PersistedReminderOccurrence> {
    const safe = safeReminderOccurrence(occurrence);
    const inserted = await this.query<ReminderRow>(
      `INSERT INTO notification_service.reminder_occurrences
        (reminder_id, workspace_id, reminder_title, due_instant, time_zone,
         quiet_start_minute, quiet_end_minute, daily_delivery_limit,
         delivery_attempt_count)
       /** Performs the values operation while preserving tenant-safe bounded behavior. */
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING reminder_id, workspace_id, reminder_title, due_instant,
                 time_zone, quiet_start_minute, quiet_end_minute,
                 daily_delivery_limit, delivery_attempt_count,
                 occurrence_status, claim_expires_at, created_at, updated_at`,
      [
        safe.id,
        safe.workspaceId,
        safe.title,
        safe.dueAt,
        safe.timeZone,
        safe.quietHours?.startMinute ?? null,
        safe.quietHours?.endMinute ?? null,
        safe.maxPerLocalDay,
        safe.deliveryAttempt,
      ],
    );
    const insertedRow = zeroOrOne(inserted.rows);
    if (insertedRow !== undefined) {
      return parsePersistedReminder(insertedRow, safe.workspaceId, safe.id);
    }

    const replay = await this.query<ReminderRow>(
      `SELECT reminder_id, workspace_id, reminder_title, due_instant,
              time_zone, quiet_start_minute, quiet_end_minute,
              daily_delivery_limit, delivery_attempt_count,
              occurrence_status, claim_expires_at, created_at, updated_at
       FROM notification_service.reminder_occurrences
       WHERE workspace_id = $1 AND reminder_id = $2
       LIMIT 2`,
      [safe.workspaceId, safe.id],
    );
    const persisted = parsePersistedReminder(
      /** Performs the exactly one operation while preserving tenant-safe bounded behavior. */
      exactlyOne(replay.rows),
      safe.workspaceId,
      safe.id,
    );
    if (!scheduleMatches(persisted, safe)) {
      throw new NotificationReplayConflictError();
    }
    return persisted;
  }

  /** Compatibility alias for service code that names the write explicitly. */
  async createOccurrence(
    occurrence: ReminderOccurrence,
  ): Promise<PersistedReminderOccurrence> {
    return await this.schedule(occurrence);
  }

  /** Returns a bounded deterministic set of due, unclaimed reminder occurrences. */
  async listDue(now: string, limit: number): Promise<ReminderOccurrence[]> {
    const safeNow = requireTimestamp(now);
    const safeLimit = requireInteger(limit, 1, MAX_REMINDER_BATCH_SIZE);
    const result = await this.query<ReminderRow>(
      `SELECT reminder_id, workspace_id, reminder_title, due_instant,
              time_zone, quiet_start_minute, quiet_end_minute,
              daily_delivery_limit, delivery_attempt_count,
              occurrence_status, claim_expires_at, created_at, updated_at
       FROM notification_service.reminder_occurrences
       WHERE occurrence_status = 'pending'
         AND due_instant <= $1
         /** Performs the and operation while preserving tenant-safe bounded behavior. */
         AND (claim_expires_at IS NULL OR claim_expires_at <= $1)
       ORDER BY due_instant ASC, reminder_id ASC
       LIMIT $2`,
      [safeNow, safeLimit],
    );
    if (result.rows.length > safeLimit) {
      return persistenceFailure();
    }
    return result.rows.map((row) => baseReminderFromRow(row));
  }

  /** Acquires a fenced expiring claim and returns its opaque per-attempt token. */
  async claim(
    workspaceId: string,
    reminderId: string,
    dueAt: string,
    deliveryAttempt: number,
  ): Promise<string | null> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeReminderId = requireUuid(reminderId);
    const safeDueAt = requireTimestamp(dueAt);
    const safeDeliveryAttempt = requireInteger(
      deliveryAttempt,
      0,
      MAX_DELIVERY_ATTEMPTS,
    );
    const claimKey = requireUuid(this.claimKeyFactory());
    const result = await this.query<IdentifierRow>(
      `UPDATE notification_service.reminder_occurrences
       SET claim_key_hash = $3,
           claim_expires_at = clock_timestamp()
             + make_interval(secs => $4),
           updated_at = clock_timestamp()
       WHERE workspace_id = $1
         AND reminder_id = $2
         AND occurrence_status = 'pending'
         AND due_instant = $5
         AND delivery_attempt_count = $6
         /** Performs the and operation while preserving tenant-safe bounded behavior. */
         AND (claim_expires_at IS NULL OR claim_expires_at <= clock_timestamp())
       RETURNING reminder_id`,
      [
        safeWorkspaceId,
        safeReminderId,
        /** Performs the hash notification idempotency key operation while preserving tenant-safe bounded behavior. */
        hashNotificationIdempotencyKey(claimKey),
        this.claimLeaseSeconds,
        safeDueAt,
        safeDeliveryAttempt,
      ],
    );
    const row = zeroOrOne(result.rows);
    if (row === undefined) {
      return null;
    }
    /** Performs the require expected uuid operation while preserving tenant-safe bounded behavior. */
    requireExpectedUuid(requireUuid(row.reminder_id), safeReminderId);
    return claimKey;
  }

  /** Counts delivered outcomes for one workspace and one local calendar date. */
  async countDelivered(
    workspaceId: string,
    localDate: string,
  ): Promise<number> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeLocalDate = requireLocalDate(localDate);
    const result = await this.query<CountRow>(
      `SELECT count(*) AS delivery_count
       FROM notification_service.reminder_outcomes
       WHERE workspace_id = $1
         AND outcome_kind = 'delivered'
         AND delivery_local_date = $2`,
      [safeWorkspaceId, safeLocalDate],
    );
    return requireInteger(
      /** Performs the exactly one operation while preserving tenant-safe bounded behavior. */
      exactlyOne(result.rows).delivery_count,
      0,
      Number.MAX_SAFE_INTEGER,
    );
  }

  /** Atomically completes a fenced claim and appends its immutable delivered outcome. */
  async markDelivered(
    reminder: ReminderOccurrence,
    deliveredAt: string,
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    const safe = safeReminderOccurrence(reminder);
    const safeDeliveredAt = requireTimestamp(deliveredAt);
    const claimDigest = hashNotificationIdempotencyKey(claimKey);
    const idempotencyDigest = hashNotificationIdempotencyKey(idempotencyKey);
    const outcomeId = requireUuid(this.uuidFactory());
    const result = await this.query<TransitionRow>(
      `WITH transitioned_occurrence AS (
         UPDATE notification_service.reminder_occurrences
         SET occurrence_status = 'delivered',
             updated_at = clock_timestamp()
         WHERE workspace_id = $1
           AND reminder_id = $2
           AND due_instant = $3
           AND delivery_attempt_count = $4
           AND occurrence_status = 'pending'
           AND claim_key_hash = $5
           AND claim_expires_at > clock_timestamp()
         RETURNING workspace_id, reminder_id
       ), inserted_outcome AS (
         INSERT INTO notification_service.reminder_outcomes
           (outcome_id, workspace_id, reminder_id, outcome_kind, occurred_at,
            next_attempt_at, outcome_reason, idempotency_key_hash,
            delivery_local_date)
         SELECT $6, workspace_id, reminder_id, 'delivered', $7, NULL, NULL,
                $9, ($7::timestamptz AT TIME ZONE $8)::date
         FROM transitioned_occurrence
         RETURNING outcome_id
       )
       SELECT EXISTS (SELECT 1 FROM transitioned_occurrence) AS transitioned,
              /** Performs the exists operation while preserving tenant-safe bounded behavior. */
              EXISTS (SELECT 1 FROM inserted_outcome) AS outcome_inserted`,
      [
        safe.workspaceId,
        safe.id,
        safe.dueAt,
        safe.deliveryAttempt,
        claimDigest,
        outcomeId,
        safeDeliveredAt,
        safe.timeZone,
        idempotencyDigest,
      ],
    );
    /** Performs the require successful transition operation while preserving tenant-safe bounded behavior. */
    requireSuccessfulTransition(exactlyOne(result.rows));
  }

  /** Atomically releases a fenced claim, reschedules the occurrence, and appends a deferral outcome. */
  async defer(
    reminder: ReminderOccurrence,
    nextAttemptAt: string,
    reason: 'quiet_hours' | 'daily_limit',
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    const safe = safeReminderOccurrence(reminder);
    const safeNextAttemptAt = requireTimestamp(nextAttemptAt);
    const claimDigest = hashNotificationIdempotencyKey(claimKey);
    const idempotencyDigest = hashNotificationIdempotencyKey(idempotencyKey);
    const outcomeId = requireUuid(this.uuidFactory());
    const result = await this.query<TransitionRow>(
      `WITH transitioned_occurrence AS (
         UPDATE notification_service.reminder_occurrences
         SET due_instant = $5,
             claim_key_hash = NULL,
             claim_expires_at = NULL,
             updated_at = clock_timestamp()
         WHERE workspace_id = $1
           AND reminder_id = $2
           AND due_instant = $3
           AND delivery_attempt_count = $4
           AND occurrence_status = 'pending'
           AND claim_key_hash = $6
           AND claim_expires_at > clock_timestamp()
         RETURNING workspace_id, reminder_id
       ), inserted_outcome AS (
         INSERT INTO notification_service.reminder_outcomes
           (outcome_id, workspace_id, reminder_id, outcome_kind, occurred_at,
            next_attempt_at, outcome_reason, idempotency_key_hash,
            delivery_local_date)
         SELECT $7, workspace_id, reminder_id, 'deferred', clock_timestamp(),
                $5, $8, $9, NULL
         FROM transitioned_occurrence
         RETURNING outcome_id
       )
       SELECT EXISTS (SELECT 1 FROM transitioned_occurrence) AS transitioned,
              /** Performs the exists operation while preserving tenant-safe bounded behavior. */
              EXISTS (SELECT 1 FROM inserted_outcome) AS outcome_inserted`,
      [
        safe.workspaceId,
        safe.id,
        safe.dueAt,
        safe.deliveryAttempt,
        safeNextAttemptAt,
        claimDigest,
        outcomeId,
        reason,
        idempotencyDigest,
      ],
    );
    /** Performs the require successful transition operation while preserving tenant-safe bounded behavior. */
    requireSuccessfulTransition(exactlyOne(result.rows));
  }

  /** Atomically records either a bounded retry or a terminal attempt-limit failure. */
  async fail(
    reminder: ReminderOccurrence,
    retryAt: string | null,
    reason: 'delivery_failed' | 'attempt_limit',
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void> {
    const safe = safeReminderOccurrence(reminder);
    const claimDigest = hashNotificationIdempotencyKey(claimKey);
    const idempotencyDigest = hashNotificationIdempotencyKey(idempotencyKey);
    const outcomeId = requireUuid(this.uuidFactory());
    if (reason === 'delivery_failed') {
      if (retryAt === null || safe.deliveryAttempt >= MAX_DELIVERY_ATTEMPTS) {
        return persistenceFailure();
      }
      const safeRetryAt = requireTimestamp(retryAt);
      const result = await this.query<TransitionRow>(
        `WITH transitioned_occurrence AS (
           UPDATE notification_service.reminder_occurrences
           SET due_instant = $5,
               delivery_attempt_count = delivery_attempt_count + 1,
               claim_key_hash = NULL,
               claim_expires_at = NULL,
               updated_at = clock_timestamp()
           WHERE workspace_id = $1
             AND reminder_id = $2
             AND due_instant = $3
             AND delivery_attempt_count = $4
             AND occurrence_status = 'pending'
             AND claim_key_hash = $6
             AND claim_expires_at > clock_timestamp()
           RETURNING workspace_id, reminder_id
         ), inserted_outcome AS (
           INSERT INTO notification_service.reminder_outcomes
             (outcome_id, workspace_id, reminder_id, outcome_kind, occurred_at,
              next_attempt_at, outcome_reason, idempotency_key_hash,
              delivery_local_date)
           SELECT $7, workspace_id, reminder_id, 'failed', clock_timestamp(),
                  $5, 'delivery_failed', $8, NULL
           FROM transitioned_occurrence
           RETURNING outcome_id
         )
         SELECT EXISTS (SELECT 1 FROM transitioned_occurrence) AS transitioned,
                /** Performs the exists operation while preserving tenant-safe bounded behavior. */
                EXISTS (SELECT 1 FROM inserted_outcome) AS outcome_inserted`,
        [
          safe.workspaceId,
          safe.id,
          safe.dueAt,
          safe.deliveryAttempt,
          safeRetryAt,
          claimDigest,
          outcomeId,
          idempotencyDigest,
        ],
      );
      /** Performs the require successful transition operation while preserving tenant-safe bounded behavior. */
      requireSuccessfulTransition(exactlyOne(result.rows));
      return;
    }

    if (retryAt !== null || safe.deliveryAttempt !== MAX_DELIVERY_ATTEMPTS) {
      return persistenceFailure();
    }
    const result = await this.query<TransitionRow>(
      `WITH transitioned_occurrence AS (
         UPDATE notification_service.reminder_occurrences
         SET occurrence_status = 'failed',
             updated_at = clock_timestamp()
         WHERE workspace_id = $1
           AND reminder_id = $2
           AND due_instant = $3
           AND delivery_attempt_count = $4
           AND occurrence_status = 'pending'
           AND claim_key_hash = $5
           AND claim_expires_at > clock_timestamp()
         RETURNING workspace_id, reminder_id
       ), inserted_outcome AS (
         INSERT INTO notification_service.reminder_outcomes
           (outcome_id, workspace_id, reminder_id, outcome_kind, occurred_at,
            next_attempt_at, outcome_reason, idempotency_key_hash,
            delivery_local_date)
         SELECT $6, workspace_id, reminder_id, 'failed', clock_timestamp(),
                NULL, 'attempt_limit', $7, NULL
         FROM transitioned_occurrence
         RETURNING outcome_id
       )
       SELECT EXISTS (SELECT 1 FROM transitioned_occurrence) AS transitioned,
              /** Performs the exists operation while preserving tenant-safe bounded behavior. */
              EXISTS (SELECT 1 FROM inserted_outcome) AS outcome_inserted`,
      [
        safe.workspaceId,
        safe.id,
        safe.dueAt,
        safe.deliveryAttempt,
        claimDigest,
        outcomeId,
        idempotencyDigest,
      ],
    );
    /** Performs the require successful transition operation while preserving tenant-safe bounded behavior. */
    requireSuccessfulTransition(exactlyOne(result.rows));
  }

  /** Returns a bounded newest-first tenant reminder view. */
  async listReminders(
    workspaceId: string,
    limit = MAXIMUM_QUERY_LIMIT,
  ): Promise<PersistedReminderOccurrence[]> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeLimit = requireLimit(limit);
    const result = await this.query<ReminderRow>(
      `SELECT reminder_id, workspace_id, reminder_title, due_instant,
              time_zone, quiet_start_minute, quiet_end_minute,
              daily_delivery_limit, delivery_attempt_count,
              occurrence_status, claim_expires_at, created_at, updated_at
       FROM notification_service.reminder_occurrences
       WHERE workspace_id = $1
       ORDER BY created_at DESC, reminder_id ASC
       LIMIT $2`,
      [safeWorkspaceId, safeLimit],
    );
    if (result.rows.length > safeLimit) {
      return persistenceFailure();
    }
    return result.rows.map((row) =>
      /** Performs the parse persisted reminder operation while preserving tenant-safe bounded behavior. */
      parsePersistedReminder(row, safeWorkspaceId),
    );
  }

  /** Compatibility alias retained for internal composition. */
  async listOccurrences(
    workspaceId: string,
    limit = MAXIMUM_QUERY_LIMIT,
  ): Promise<PersistedReminderOccurrence[]> {
    return await this.listReminders(workspaceId, limit);
  }

  /** Returns a bounded newest-first tenant outcome view. */
  async listOutcomes(
    workspaceId: string,
    limit = MAXIMUM_QUERY_LIMIT,
  ): Promise<ReminderOutcome[]> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeLimit = requireLimit(limit);
    const result = await this.query<OutcomeRow>(
      `SELECT outcome_id, workspace_id, reminder_id, outcome_kind,
              occurred_at, next_attempt_at, outcome_reason,
              delivery_local_date, created_at
       FROM notification_service.reminder_outcomes
       WHERE workspace_id = $1
       ORDER BY occurred_at DESC, outcome_id ASC
       LIMIT $2`,
      [safeWorkspaceId, safeLimit],
    );
    if (result.rows.length > safeLimit) {
      return persistenceFailure();
    }
    return result.rows.map((row) => parseOutcome(row, safeWorkspaceId));
  }

  /** Returns a bounded newest-first tenant inbox view. */
  async listInbox(
    workspaceId: string,
    limit = MAXIMUM_QUERY_LIMIT,
  ): Promise<InboxMessage[]> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeLimit = requireLimit(limit);
    const result = await this.query<InboxRow>(
      `SELECT message_id, workspace_id, reminder_id, message_title,
              due_instant, time_zone, delivered_at, read_at, created_at
       FROM notification_service.inbox_messages
       WHERE workspace_id = $1
       ORDER BY delivered_at DESC, message_id ASC
       LIMIT $2`,
      [safeWorkspaceId, safeLimit],
    );
    if (result.rows.length > safeLimit) {
      return persistenceFailure();
    }
    return result.rows.map((row) => parseInbox(row, safeWorkspaceId));
  }

  /** Compatibility alias retained for internal composition. */
  async listInboxMessages(
    workspaceId: string,
    limit = MAXIMUM_QUERY_LIMIT,
  ): Promise<InboxMessage[]> {
    return await this.listInbox(workspaceId, limit);
  }
}

/** Idempotent in-app delivery adapter backed by the notification inbox table. */
export class PostgresInAppDeliveryGateway implements ReminderDeliveryGateway {
  /** Creates the component with validated dependencies and bounded configuration. */
  constructor(
    private readonly client: NotificationSqlClient,
    private readonly uuidFactory: () => string = randomUUID,
  ) {}

  /** Executes one parameterized PostgreSQL statement and maps transport failures to a credential-free service error. */
  private async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      throw new NotificationPersistenceError();
    }
  }

  /** Inserts one idempotent in-app message or verifies the exact persisted replay. */
  async deliver(message: ReminderDelivery): Promise<void> {
    const safe = validateDelivery(message);
    const messageId = requireUuid(this.uuidFactory());
    const digest = hashNotificationIdempotencyKey(safe.idempotencyKey);
    const inserted = await this.query<InboxRow>(
      `INSERT INTO notification_service.inbox_messages
        (message_id, workspace_id, reminder_id, message_title, due_instant,
         time_zone, idempotency_key_hash, delivered_at)
       /** Performs the values operation while preserving tenant-safe bounded behavior. */
       VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())
       ON CONFLICT DO NOTHING
       RETURNING message_id, workspace_id, reminder_id, message_title,
                 due_instant, time_zone, delivered_at, read_at, created_at`,
      [
        messageId,
        safe.workspaceId,
        safe.reminderId,
        safe.title,
        safe.dueAt,
        safe.timeZone,
        digest,
      ],
    );
    const insertedRow = zeroOrOne(inserted.rows);
    if (insertedRow !== undefined) {
      const persisted = parseInbox(insertedRow, safe.workspaceId);
      if (!inboxMatches(persisted, safe)) {
        throw new NotificationReplayConflictError();
      }
      return;
    }

    const replay = await this.query<InboxRow>(
      `SELECT message_id, workspace_id, reminder_id, message_title,
              due_instant, time_zone, delivered_at, read_at, created_at
       FROM notification_service.inbox_messages
       WHERE workspace_id = $1 AND idempotency_key_hash = $2
       LIMIT 2`,
      [safe.workspaceId, digest],
    );
    const persisted = parseInbox(exactlyOne(replay.rows), safe.workspaceId);
    if (!inboxMatches(persisted, safe)) {
      throw new NotificationReplayConflictError();
    }
  }
}
