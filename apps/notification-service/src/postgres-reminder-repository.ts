import { createHash, randomUUID } from 'node:crypto';
import {
  MAX_DAILY_REMINDERS,
  MAX_DELIVERY_ATTEMPTS,
  MAX_REMINDER_BATCH_SIZE,
  type ReminderDelivery,
  type ReminderDeliveryGateway,
  type ReminderOccurrence,
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

interface CountRow {
  delivery_count: unknown;
}

interface IdentifierRow {
  reminder_id: unknown;
}

interface TransitionRow {
  transitioned: unknown;
  outcome_inserted: unknown;
}

/** Safe public failure for invalid input, malformed rows, and SQL failures. */
export class NotificationPersistenceError extends Error {
  constructor() {
    super('Notification persistence operation failed');
    this.name = 'NotificationPersistenceError';
  }
}

/** Signals that an idempotent identifier was reused with another payload. */
export class NotificationReplayConflictError extends Error {
  constructor() {
    super('Notification replay conflicts with the persisted payload');
    this.name = 'NotificationReplayConflictError';
  }
}

function persistenceFailure(): never {
  throw new NotificationPersistenceError();
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return persistenceFailure();
  }
  return value.toLowerCase();
}

function requireExpectedUuid(actual: string, expected: string): void {
  if (actual !== requireUuid(expected)) {
    persistenceFailure();
  }
}

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

function requireNullableTimestamp(value: unknown): string | null {
  return value === null ? null : requireTimestamp(value);
}

function requireLocalDate(value: unknown): string {
  const candidate =
    value instanceof Date ? value.toISOString().slice(0, 10) : value;
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

function requireNullableLocalDate(value: unknown): string | null {
  return value === null ? null : requireLocalDate(value);
}

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

function requireLimit(value: number): number {
  return requireInteger(value, 1, MAXIMUM_QUERY_LIMIT);
}

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

function exactlyOne<Row>(rows: readonly Row[]): Row {
  if (rows.length !== 1) {
    return persistenceFailure();
  }
  return rows[0] as Row;
}

function zeroOrOne<Row>(rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) {
    return persistenceFailure();
  }
  return rows[0];
}

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
      quietStart === null || quietEnd === null
        ? null
        : { startMinute: quietStart, endMinute: quietEnd },
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

function parsePersistedReminder(
  row: ReminderRow,
  expectedWorkspaceId?: string,
  expectedReminderId?: string,
): PersistedReminderOccurrence {
  const reminder = baseReminderFromRow(row);
  if (expectedWorkspaceId !== undefined) {
    requireExpectedUuid(reminder.workspaceId, expectedWorkspaceId);
  }
  if (expectedReminderId !== undefined) {
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

function scheduleMatches(
  persisted: PersistedReminderOccurrence,
  attempted: ReminderOccurrence,
): boolean {
  return (
    persisted.status === 'pending' &&
    persisted.id === attempted.id &&
    persisted.workspaceId === attempted.workspaceId &&
    persisted.title === attempted.title &&
    persisted.dueAt === attempted.dueAt &&
    persisted.timeZone === attempted.timeZone &&
    persisted.maxPerLocalDay === attempted.maxPerLocalDay &&
    persisted.deliveryAttempt === attempted.deliveryAttempt &&
    persisted.quietHours?.startMinute === attempted.quietHours?.startMinute &&
    persisted.quietHours?.endMinute === attempted.quietHours?.endMinute
  );
}

function inboxMatches(
  persisted: InboxMessage,
  attempted: ReminderDelivery,
): boolean {
  return (
    persisted.workspaceId === attempted.workspaceId &&
    persisted.reminderId === attempted.reminderId &&
    persisted.title === attempted.title &&
    persisted.dueAt === attempted.dueAt &&
    persisted.timeZone === attempted.timeZone
  );
}

function requireSuccessfulTransition(row: TransitionRow): void {
  if (row.transitioned !== true || row.outcome_inserted !== true) {
    persistenceFailure();
  }
}

/** Parameterized, tenant-scoped PostgreSQL reminder repository. */
export class PostgresReminderRepository implements ReminderRepository {
  constructor(
    private readonly client: NotificationSqlClient,
    private readonly claimLeaseSeconds = 300,
    private readonly uuidFactory: () => string = randomUUID,
    private readonly claimKeyFactory: () => string = randomUUID,
  ) {
    requireInteger(
      claimLeaseSeconds,
      MINIMUM_CLAIM_LEASE_SECONDS,
      MAXIMUM_CLAIM_LEASE_SECONDS,
    );
  }

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

  async claim(workspaceId: string, reminderId: string): Promise<string | null> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeReminderId = requireUuid(reminderId);
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
         AND (claim_expires_at IS NULL OR claim_expires_at <= clock_timestamp())
       RETURNING reminder_id`,
      [
        safeWorkspaceId,
        safeReminderId,
        hashNotificationIdempotencyKey(claimKey),
        this.claimLeaseSeconds,
      ],
    );
    const row = zeroOrOne(result.rows);
    if (row === undefined) {
      return null;
    }
    requireExpectedUuid(requireUuid(row.reminder_id), safeReminderId);
    return claimKey;
  }

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
      exactlyOne(result.rows).delivery_count,
      0,
      Number.MAX_SAFE_INTEGER,
    );
  }

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
    requireSuccessfulTransition(exactlyOne(result.rows));
  }

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
    requireSuccessfulTransition(exactlyOne(result.rows));
  }

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
  constructor(
    private readonly client: NotificationSqlClient,
    private readonly uuidFactory: () => string = randomUUID,
  ) {}

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

  async deliver(message: ReminderDelivery): Promise<void> {
    const safe = validateDelivery(message);
    const messageId = requireUuid(this.uuidFactory());
    const digest = hashNotificationIdempotencyKey(safe.idempotencyKey);
    const inserted = await this.query<InboxRow>(
      `INSERT INTO notification_service.inbox_messages
        (message_id, workspace_id, reminder_id, message_title, due_instant,
         time_zone, idempotency_key_hash, delivered_at)
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
