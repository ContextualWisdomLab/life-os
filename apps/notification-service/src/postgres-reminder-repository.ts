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
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const MAXIMUM_IDEMPOTENCY_KEY_LENGTH = 2_048;
const MAXIMUM_QUERY_LIMIT = 100;

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

/** Immutable scheduler outcome exposed to tenant-scoped service callers. */
export interface ReminderOutcome {
  readonly id: string;
  readonly workspaceId: string;
  readonly reminderId: string;
  readonly kind: 'delivered' | 'deferred' | 'failed';
  readonly occurredAt: string;
  readonly nextAttemptAt: string | null;
  readonly reason:
    | 'quiet_hours'
    | 'daily_limit'
    | 'delivery_failed'
    | 'attempt_limit'
    | null;
  readonly deliveryLocalDate: string | null;
}

/** Durable in-app notification exposed to tenant-scoped service callers. */
export interface InboxMessage {
  readonly id: string;
  readonly workspaceId: string;
  readonly reminderId: string;
  readonly title: string;
  readonly dueAt: string;
  readonly timeZone: string;
  readonly deliveredAt: string;
  readonly readAt: string | null;
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
}

interface CountRow {
  delivered_count: unknown;
}

interface IdentifierRow {
  reminder_id?: unknown;
  outcome_id?: unknown;
  message_id?: unknown;
}

/** Safe public failure for malformed rows and database transport errors. */
export class NotificationPersistenceError extends Error {
  constructor() {
    super('Notification persistence operation failed');
    this.name = 'NotificationPersistenceError';
  }
}

/** Signals that one inbox idempotency key was reused with another payload. */
export class NotificationIdempotencyConflictError extends Error {
  constructor() {
    super('Notification idempotency key reused with a different payload');
    this.name = 'NotificationIdempotencyConflictError';
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
  const candidate = value instanceof Date ? value : new Date(String(value));
  if (
    (typeof value !== 'string' && !(value instanceof Date)) ||
    Number.isNaN(candidate.getTime())
  ) {
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

function requireIdempotencyKey(value: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_IDEMPOTENCY_KEY_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return persistenceFailure();
  }
  return value;
}

function idempotencyDigest(value: string): Buffer {
  return createHash('sha256').update(requireIdempotencyKey(value), 'utf8').digest();
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

function parseReminder(
  row: ReminderRow,
  expectedWorkspaceId?: string,
  expectedReminderId?: string,
): ReminderOccurrence {
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
  const reminder = validateReminderOccurrence({
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
  if (expectedWorkspaceId !== undefined) {
    requireExpectedUuid(reminder.workspaceId, expectedWorkspaceId);
  }
  if (expectedReminderId !== undefined) {
    requireExpectedUuid(reminder.id, expectedReminderId);
  }
  return reminder;
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
  };
  requireExpectedUuid(outcome.workspaceId, expectedWorkspaceId);
  return outcome;
}

function parseInbox(
  row: InboxRow,
  expectedWorkspaceId: string,
): InboxMessage {
  const validated = validateReminderOccurrence({
    id: requireUuid(row.reminder_id),
    workspaceId: requireUuid(row.workspace_id),
    title: row.message_title,
    dueAt: requireTimestamp(row.due_instant),
    timeZone: row.time_zone,
    quietHours: null,
    maxPerLocalDay: 1,
    deliveryAttempt: 0,
  });
  requireExpectedUuid(validated.workspaceId, expectedWorkspaceId);
  return {
    id: requireUuid(row.message_id),
    workspaceId: validated.workspaceId,
    reminderId: validated.id,
    title: validated.title,
    dueAt: validated.dueAt,
    timeZone: validated.timeZone,
    deliveredAt: requireTimestamp(row.delivered_at),
    readAt: requireNullableTimestamp(row.read_at),
  };
}

function validateDelivery(message: ReminderDelivery): ReminderDelivery {
  const reminder = validateReminderOccurrence({
    id: message.reminderId,
    workspaceId: message.workspaceId,
    title: message.title,
    dueAt: message.dueAt,
    timeZone: message.timeZone,
    quietHours: null,
    maxPerLocalDay: 1,
    deliveryAttempt: 0,
  });
  return {
    workspaceId: reminder.workspaceId,
    reminderId: reminder.id,
    title: reminder.title,
    dueAt: reminder.dueAt,
    timeZone: reminder.timeZone,
    idempotencyKey: requireIdempotencyKey(message.idempotencyKey),
  };
}

function assertInboxReplay(
  persisted: InboxMessage,
  attempted: ReminderDelivery,
): void {
  if (
    persisted.workspaceId !== attempted.workspaceId ||
    persisted.reminderId !== attempted.reminderId ||
    persisted.title !== attempted.title ||
    persisted.dueAt !== attempted.dueAt ||
    persisted.timeZone !== attempted.timeZone
  ) {
    throw new NotificationIdempotencyConflictError();
  }
}

/** Parameterized, tenant-scoped PostgreSQL reminder repository. */
export class PostgresReminderRepository implements ReminderRepository {
  constructor(
    private readonly client: NotificationSqlClient,
    private readonly claimLeaseSeconds = 300,
  ) {
    requireInteger(claimLeaseSeconds, 30, 900);
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

  async createOccurrence(
    occurrence: ReminderOccurrence,
  ): Promise<ReminderOccurrence> {
    const safe = validateReminderOccurrence(occurrence);
    const result = await this.query<ReminderRow>(
      `INSERT INTO notification_service.reminder_occurrences
        (reminder_id, workspace_id, reminder_title, due_instant, time_zone,
         quiet_start_minute, quiet_end_minute, daily_delivery_limit,
         delivery_attempt_count)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING reminder_id, workspace_id, reminder_title, due_instant,
                 time_zone, quiet_start_minute, quiet_end_minute,
                 daily_delivery_limit, delivery_attempt_count`,
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
    return parseReminder(
      exactlyOne(result.rows),
      safe.workspaceId,
      safe.id,
    );
  }

  async listDue(now: string, limit: number): Promise<ReminderOccurrence[]> {
    const safeNow = requireTimestamp(now);
    const safeLimit = requireInteger(limit, 1, MAX_REMINDER_BATCH_SIZE);
    const result = await this.query<ReminderRow>(
      `SELECT reminder_id, workspace_id, reminder_title, due_instant,
              time_zone, quiet_start_minute, quiet_end_minute,
              daily_delivery_limit, delivery_attempt_count
       FROM notification_service.reminder_occurrences
       WHERE occurrence_status = 'pending'
         AND due_instant <= $1
         AND (claim_key_hash IS NULL OR claim_expires_at <= $1)
       ORDER BY due_instant ASC, reminder_id ASC
       LIMIT $2`,
      [safeNow, safeLimit],
    );
    if (result.rows.length > safeLimit) {
      return persistenceFailure();
    }
    return result.rows.map((row) => parseReminder(row));
  }

  async claim(
    workspaceId: string,
    reminderId: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeReminderId = requireUuid(reminderId);
    const result = await this.query<IdentifierRow>(
      `UPDATE notification_service.reminder_occurrences
       SET claim_key_hash = $3,
           claim_expires_at = clock_timestamp()
             + ($4::integer * interval '1 second'),
           updated_at = clock_timestamp()
       WHERE workspace_id = $1
         AND reminder_id = $2
         AND occurrence_status = 'pending'
         AND (claim_key_hash IS NULL OR claim_expires_at <= clock_timestamp())
       RETURNING reminder_id`,
      [
        safeWorkspaceId,
        safeReminderId,
        idempotencyDigest(idempotencyKey),
        this.claimLeaseSeconds,
      ],
    );
    const row = zeroOrOne(result.rows);
    if (row?.reminder_id !== undefined) {
      requireExpectedUuid(requireUuid(row.reminder_id), safeReminderId);
    }
    return row !== undefined;
  }

  async countDelivered(
    workspaceId: string,
    localDate: string,
  ): Promise<number> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeLocalDate = requireLocalDate(localDate);
    const result = await this.query<CountRow>(
      `SELECT count(*) AS delivered_count
       FROM notification_service.reminder_outcomes
       WHERE workspace_id = $1
         AND outcome_kind = 'delivered'
         AND delivery_local_date = $2`,
      [safeWorkspaceId, safeLocalDate],
    );
    return requireInteger(
      exactlyOne(result.rows).delivered_count,
      0,
      Number.MAX_SAFE_INTEGER,
    );
  }

  async markDelivered(
    reminder: ReminderOccurrence,
    deliveredAt: string,
    idempotencyKey: string,
  ): Promise<void> {
    const safe = validateReminderOccurrence(reminder);
    const safeDeliveredAt = requireTimestamp(deliveredAt);
    const result = await this.query<IdentifierRow>(
      `WITH updated_occurrence AS (
         UPDATE notification_service.reminder_occurrences
         SET occurrence_status = 'delivered',
             updated_at = clock_timestamp()
         WHERE workspace_id = $1
           AND reminder_id = $2
           AND due_instant = $3
           AND delivery_attempt_count = $4
           AND occurrence_status = 'pending'
           AND claim_key_hash = $5
         RETURNING workspace_id, reminder_id
       )
       INSERT INTO notification_service.reminder_outcomes
         (outcome_id, workspace_id, reminder_id, outcome_kind, occurred_at,
          next_attempt_at, outcome_reason, idempotency_key_hash,
          delivery_local_date)
       SELECT $6, workspace_id, reminder_id, 'delivered', $7, NULL, NULL,
              $5, ($7::timestamptz AT TIME ZONE $8)::date
       FROM updated_occurrence
       RETURNING outcome_id`,
      [
        safe.workspaceId,
        safe.id,
        safe.dueAt,
        safe.deliveryAttempt,
        idempotencyDigest(idempotencyKey),
        randomUUID(),
        safeDeliveredAt,
        safe.timeZone,
      ],
    );
    requireUuid(exactlyOne(result.rows).outcome_id);
  }

  async defer(
    reminder: ReminderOccurrence,
    nextAttemptAt: string,
    reason: 'quiet_hours' | 'daily_limit',
    idempotencyKey: string,
  ): Promise<void> {
    const safe = validateReminderOccurrence(reminder);
    const safeNextAttemptAt = requireTimestamp(nextAttemptAt);
    const result = await this.query<IdentifierRow>(
      `WITH updated_occurrence AS (
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
         RETURNING workspace_id, reminder_id
       )
       INSERT INTO notification_service.reminder_outcomes
         (outcome_id, workspace_id, reminder_id, outcome_kind, occurred_at,
          next_attempt_at, outcome_reason, idempotency_key_hash,
          delivery_local_date)
       SELECT $7, workspace_id, reminder_id, 'deferred', clock_timestamp(),
              $5, $8, $6, NULL
       FROM updated_occurrence
       RETURNING outcome_id`,
      [
        safe.workspaceId,
        safe.id,
        safe.dueAt,
        safe.deliveryAttempt,
        safeNextAttemptAt,
        idempotencyDigest(idempotencyKey),
        randomUUID(),
        reason,
      ],
    );
    requireUuid(exactlyOne(result.rows).outcome_id);
  }

  async fail(
    reminder: ReminderOccurrence,
    retryAt: string | null,
    reason: 'delivery_failed' | 'attempt_limit',
    idempotencyKey: string,
  ): Promise<void> {
    const safe = validateReminderOccurrence(reminder);
    if (
      (reason === 'delivery_failed' && retryAt === null) ||
      (reason === 'attempt_limit' && retryAt !== null)
    ) {
      return persistenceFailure();
    }
    const safeRetryAt = retryAt === null ? null : requireTimestamp(retryAt);
    const nextAttemptCount =
      reason === 'delivery_failed'
        ? requireInteger(safe.deliveryAttempt + 1, 1, MAX_DELIVERY_ATTEMPTS)
        : safe.deliveryAttempt;
    const result = await this.query<IdentifierRow>(
      `WITH updated_occurrence AS (
         UPDATE notification_service.reminder_occurrences
         SET occurrence_status = CASE WHEN $5::text = 'attempt_limit'
                                      THEN 'failed' ELSE 'pending' END,
             due_instant = COALESCE($6::timestamptz, due_instant),
             delivery_attempt_count = $7,
             claim_key_hash = CASE WHEN $5::text = 'delivery_failed'
                                   THEN NULL ELSE claim_key_hash END,
             claim_expires_at = CASE WHEN $5::text = 'delivery_failed'
                                     THEN NULL ELSE claim_expires_at END,
             updated_at = clock_timestamp()
         WHERE workspace_id = $1
           AND reminder_id = $2
           AND due_instant = $3
           AND delivery_attempt_count = $4
           AND occurrence_status = 'pending'
           AND claim_key_hash = $8
         RETURNING workspace_id, reminder_id
       )
       INSERT INTO notification_service.reminder_outcomes
         (outcome_id, workspace_id, reminder_id, outcome_kind, occurred_at,
          next_attempt_at, outcome_reason, idempotency_key_hash,
          delivery_local_date)
       SELECT $9, workspace_id, reminder_id, 'failed', clock_timestamp(),
              $6, $5, $8, NULL
       FROM updated_occurrence
       RETURNING outcome_id`,
      [
        safe.workspaceId,
        safe.id,
        safe.dueAt,
        safe.deliveryAttempt,
        reason,
        safeRetryAt,
        nextAttemptCount,
        idempotencyDigest(idempotencyKey),
        randomUUID(),
      ],
    );
    requireUuid(exactlyOne(result.rows).outcome_id);
  }

  async listOccurrences(
    workspaceId: string,
    limit = MAXIMUM_QUERY_LIMIT,
  ): Promise<ReminderOccurrence[]> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeLimit = requireLimit(limit);
    const result = await this.query<ReminderRow>(
      `SELECT reminder_id, workspace_id, reminder_title, due_instant,
              time_zone, quiet_start_minute, quiet_end_minute,
              daily_delivery_limit, delivery_attempt_count
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
      parseReminder(row, safeWorkspaceId),
    );
  }

  async listOutcomes(
    workspaceId: string,
    limit = MAXIMUM_QUERY_LIMIT,
  ): Promise<ReminderOutcome[]> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeLimit = requireLimit(limit);
    const result = await this.query<OutcomeRow>(
      `SELECT outcome_id, workspace_id, reminder_id, outcome_kind,
              occurred_at, next_attempt_at, outcome_reason,
              delivery_local_date
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

  async listInboxMessages(
    workspaceId: string,
    limit = MAXIMUM_QUERY_LIMIT,
  ): Promise<InboxMessage[]> {
    const safeWorkspaceId = requireUuid(workspaceId);
    const safeLimit = requireLimit(limit);
    const result = await this.query<InboxRow>(
      `SELECT message_id, workspace_id, reminder_id, message_title,
              due_instant, time_zone, delivered_at, read_at
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
}

/** Idempotent in-app delivery adapter backed by the notification inbox table. */
export class PostgresInAppDeliveryGateway
  implements ReminderDeliveryGateway
{
  constructor(private readonly client: NotificationSqlClient) {}

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
    const digest = idempotencyDigest(safe.idempotencyKey);
    const inserted = await this.query<InboxRow>(
      `INSERT INTO notification_service.inbox_messages
        (message_id, workspace_id, reminder_id, message_title, due_instant,
         time_zone, idempotency_key_hash, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, clock_timestamp())
       ON CONFLICT ON CONSTRAINT inbox_messages_idempotency_unique DO NOTHING
       RETURNING message_id, workspace_id, reminder_id, message_title,
                 due_instant, time_zone, delivered_at, read_at`,
      [
        randomUUID(),
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
      assertInboxReplay(
        parseInbox(insertedRow, safe.workspaceId),
        safe,
      );
      return;
    }

    const replay = await this.query<InboxRow>(
      `SELECT message_id, workspace_id, reminder_id, message_title,
              due_instant, time_zone, delivered_at, read_at
       FROM notification_service.inbox_messages
       WHERE workspace_id = $1
         AND idempotency_key_hash = $2
       LIMIT 2`,
      [safe.workspaceId, digest],
    );
    assertInboxReplay(
      parseInbox(exactlyOne(replay.rows), safe.workspaceId),
      safe,
    );
  }
}
