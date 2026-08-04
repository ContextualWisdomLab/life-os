/** Maximum number of reminders evaluated by one scheduler run. */
export const MAX_REMINDER_BATCH_SIZE = 100;
/** Maximum reminder title length accepted at the scheduling boundary. */
export const MAX_REMINDER_TITLE_LENGTH = 160;
/** Maximum number of reminders that may be delivered per local calendar day. */
export const MAX_DAILY_REMINDERS = 20;
/** Maximum provider delivery attempts allowed for one reminder occurrence. */
export const MAX_DELIVERY_ATTEMPTS = 3;

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u;
/**
 * Hard policy-search horizon. Seventy-two hours covers the next local date,
 * a nearly full-day quiet interval, and large IANA offset discontinuities
 * while keeping every scheduler evaluation bounded.
 */
const MAX_POLICY_SEARCH_MINUTES = 72 * 60;

/** Local quiet-hours interval expressed as minute-of-day values. */
export interface QuietHours {
  readonly startMinute: number;
  readonly endMinute: number;
}

/** A validated reminder occurrence ready for bounded scheduling. */
export interface ReminderOccurrence {
  readonly id: string;
  readonly workspaceId: string;
  readonly title: string;
  readonly dueAt: string;
  readonly timeZone: string;
  readonly quietHours: QuietHours | null;
  readonly maxPerLocalDay: number;
  readonly deliveryAttempt: number;
}

/** Credential-free message passed to a delivery adapter. */
export interface ReminderDelivery {
  readonly workspaceId: string;
  readonly reminderId: string;
  readonly title: string;
  readonly dueAt: string;
  readonly timeZone: string;
  readonly idempotencyKey: string;
}

/** Provider boundary. Implementations must honor the supplied idempotency key. */
export interface ReminderDeliveryGateway {
  /** Inserts one idempotent in-app message or verifies the exact persisted replay. */
  deliver(message: ReminderDelivery): Promise<void>;
}

/**
 * Persistence boundary. Every mutation is tenant-scoped and includes the exact
 * reminder occurrence so repositories can implement atomic claims safely.
 */
export interface ReminderRepository {
  /** Returns a bounded deterministic set of due, unclaimed reminder occurrences. */
  listDue(now: string, limit: number): Promise<readonly unknown[]>;
  /** Acquires a fenced expiring claim and returns its opaque per-attempt token. */
  claim(
    workspaceId: string,
    reminderId: string,
    dueAt: string,
    deliveryAttempt: number,
  ): Promise<string | null>;
  /** Counts delivered outcomes for one workspace and one local calendar date. */
  countDelivered(workspaceId: string, localDate: string): Promise<number>;
  /** Atomically completes a fenced claim and appends its immutable delivered outcome. */
  markDelivered(
    reminder: ReminderOccurrence,
    deliveredAt: string,
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void>;
  /** Atomically releases a fenced claim, reschedules the occurrence, and appends a deferral outcome. */
  defer(
    reminder: ReminderOccurrence,
    nextAttemptAt: string,
    reason: 'quiet_hours' | 'daily_limit',
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void>;
  /** Atomically records either a bounded retry or a terminal attempt-limit failure. */
  fail(
    reminder: ReminderOccurrence,
    retryAt: string | null,
    reason: 'delivery_failed' | 'attempt_limit',
    claimKey: string,
    idempotencyKey: string,
  ): Promise<void>;
}

/** Stable validation codes suitable for logs and RFC 9457 mappings. */
export type ReminderValidationCode =
  | 'invalid_identifier'
  | 'invalid_title'
  | 'invalid_due_at'
  | 'invalid_time_zone'
  | 'invalid_quiet_hours'
  | 'invalid_daily_limit'
  | 'invalid_delivery_attempt'
  | 'invalid_record';

/** Error raised when an untrusted reminder record violates the boundary. */
export class ReminderValidationError extends Error {
  /** Creates the component with validated dependencies and bounded configuration. */
  constructor(readonly code: ReminderValidationCode) {
    super(code);
    this.name = 'ReminderValidationError';
  }
}

/** Aggregate result for one bounded scheduler iteration. */
export interface ReminderRunReport {
  readonly scanned: number;
  readonly delivered: number;
  readonly deferred: number;
  readonly failed: number;
  readonly persistenceFailures: number;
  readonly duplicateClaims: number;
  readonly invalid: number;
}

/** Defines the zoned clock contract used across notification-service boundaries. */
interface ZonedClock {
  readonly localDate: string;
  readonly minuteOfDay: number;
}

/** Narrows an untrusted value to a non-array object before field validation. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates and canonicalizes an untrusted UUIDv4 identifier before it reaches SQL. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new ReminderValidationError('invalid_identifier');
  }
  return value;
}

/** Validates bounded user-authored reminder text without silently normalizing it. */
function requireTitle(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_REMINDER_TITLE_LENGTH ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new ReminderValidationError('invalid_title');
  }
  return value;
}

/** Validates and canonicalizes an absolute RFC 3339 reminder instant. */
function requireInstant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !ISO_INSTANT_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ReminderValidationError('invalid_due_at');
  }
  return new Date(value).toISOString();
}

/** Validates an IANA time-zone identifier through the platform time-zone database. */
function requireTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new ReminderValidationError('invalid_time_zone');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
  } catch {
    throw new ReminderValidationError('invalid_time_zone');
  }
  return value;
}

/** Parses one optional integer setting and enforces its documented inclusive range. */
function requireBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  code: ReminderValidationCode,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new ReminderValidationError(code);
  }
  return value;
}

/** Validates an optional non-empty local quiet-hours interval. */
function requireQuietHours(value: unknown): QuietHours | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) {
    throw new ReminderValidationError('invalid_quiet_hours');
  }
  const startMinute = requireBoundedInteger(
    value.startMinute,
    0,
    1_439,
    'invalid_quiet_hours',
  );
  const endMinute = requireBoundedInteger(
    value.endMinute,
    0,
    1_439,
    'invalid_quiet_hours',
  );
  if (startMinute === endMinute) {
    throw new ReminderValidationError('invalid_quiet_hours');
  }
  return { startMinute, endMinute };
}

/** Validates and normalizes an untrusted reminder record. */
export function validateReminderOccurrence(value: unknown): ReminderOccurrence {
  if (!isRecord(value)) {
    throw new ReminderValidationError('invalid_record');
  }
  return {
    id: requireUuid(value.id),
    workspaceId: requireUuid(value.workspaceId),
    title: requireTitle(value.title),
    dueAt: requireInstant(value.dueAt),
    timeZone: requireTimeZone(value.timeZone),
    quietHours: requireQuietHours(value.quietHours),
    maxPerLocalDay: requireBoundedInteger(
      value.maxPerLocalDay,
      1,
      MAX_DAILY_REMINDERS,
      'invalid_daily_limit',
    ),
    deliveryAttempt: requireBoundedInteger(
      value.deliveryAttempt,
      0,
      MAX_DELIVERY_ATTEMPTS,
      'invalid_delivery_attempt',
    ),
  };
}

/** Projects an absolute instant into a validated local date and minute for one IANA time zone. */
function zonedClock(instant: Date, timeZone: string): ZonedClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = values.get('year');
  const month = values.get('month');
  const day = values.get('day');
  const hour = Number(values.get('hour'));
  const minute = Number(values.get('minute'));
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new ReminderValidationError('invalid_time_zone');
  }
  return {
    localDate: `${year}-${month}-${day}`,
    minuteOfDay: hour * 60 + minute,
  };
}

/** Returns whether a local minute falls inside a possibly overnight interval. */
export function isWithinQuietHours(
  minuteOfDay: number,
  quietHours: QuietHours,
): boolean {
  if (quietHours.startMinute < quietHours.endMinute) {
    return (
      minuteOfDay >= quietHours.startMinute &&
      minuteOfDay < quietHours.endMinute
    );
  }
  return (
    minuteOfDay >= quietHours.startMinute || minuteOfDay < quietHours.endMinute
  );
}

/** Finds the first bounded absolute instant allowed by next-day and quiet-hours policy. */
function nextAllowedInstant(
  now: Date,
  timeZone: string,
  quietHours: QuietHours | null,
  requireNextLocalDay: boolean,
): string {
  const initialDate = zonedClock(now, timeZone).localDate;
  for (
    let offsetMinutes = 1;
    offsetMinutes <= MAX_POLICY_SEARCH_MINUTES;
    offsetMinutes += 1
  ) {
    const candidate = new Date(now.getTime() + offsetMinutes * 60_000);
    const clock = zonedClock(candidate, timeZone);
    if (
      (!requireNextLocalDay || clock.localDate !== initialDate) &&
      (quietHours === null ||
        !isWithinQuietHours(clock.minuteOfDay, quietHours))
    ) {
      return candidate.toISOString();
    }
  }
  throw new ReminderValidationError('invalid_time_zone');
}

/** Computes the bounded linear retry instant for the next delivery attempt. */
function retryInstant(now: Date, deliveryAttempt: number): string {
  const boundedAttempt = Math.min(deliveryAttempt + 1, MAX_DELIVERY_ATTEMPTS);
  return new Date(now.getTime() + boundedAttempt * 5 * 60_000).toISOString();
}

/** Builds the stable tenant-scoped occurrence key supplied to idempotent delivery adapters. */
export function idempotencyKey(reminder: ReminderOccurrence): string {
  return `${reminder.workspaceId}:${reminder.id}:${reminder.dueAt}`;
}

/**
 * Evaluates due reminders in deterministic order while enforcing tenant-scoped
 * claims, local quiet hours, daily limits, bounded retries, and idempotent delivery.
 */
export class ReminderScheduler {
  readonly batchSize: number;

  /** Creates the component with validated dependencies and bounded configuration. */
  constructor(
    private readonly repository: ReminderRepository,
    private readonly gateway: ReminderDeliveryGateway,
    batchSize = 50,
  ) {
    if (
      !Number.isInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > MAX_REMINDER_BATCH_SIZE
    ) {
      throw new RangeError('batchSize must be between 1 and 100');
    }
    this.batchSize = batchSize;
  }

  /** Processes one bounded scheduler iteration with fenced claims and deterministic outcome accounting. */
  async run(now = new Date()): Promise<ReminderRunReport> {
    if (Number.isNaN(now.getTime())) {
      throw new RangeError('now must be a valid instant');
    }
    const records = await this.repository.listDue(
      now.toISOString(),
      this.batchSize,
    );
    let delivered = 0;
    let deferred = 0;
    let failed = 0;
    let persistenceFailures = 0;
    let duplicateClaims = 0;
    let invalid = 0;

    for (const record of records.slice(0, this.batchSize)) {
      let reminder: ReminderOccurrence;
      try {
        reminder = validateReminderOccurrence(record);
      } catch (error) {
        if (error instanceof ReminderValidationError) {
          invalid += 1;
          continue;
        }
        throw error;
      }
      if (Date.parse(reminder.dueAt) > now.getTime()) {
        invalid += 1;
        continue;
      }
      const deliveryKey = idempotencyKey(reminder);
      const claimKey = await this.repository.claim(
        reminder.workspaceId,
        reminder.id,
        reminder.dueAt,
        reminder.deliveryAttempt,
      );
      if (claimKey === null) {
        duplicateClaims += 1;
        continue;
      }

      const clock = zonedClock(now, reminder.timeZone);
      const quietHours = reminder.quietHours;
      if (
        quietHours !== null &&
        isWithinQuietHours(clock.minuteOfDay, quietHours)
      ) {
        const nextAttemptAt = nextAllowedInstant(
          now,
          reminder.timeZone,
          quietHours,
          false,
        );
        try {
          await this.repository.defer(
            reminder,
            nextAttemptAt,
            'quiet_hours',
            claimKey,
            deliveryKey,
          );
          deferred += 1;
        } catch {
          persistenceFailures += 1;
        }
        continue;
      }

      let deliveredToday: number;
      try {
        deliveredToday = await this.repository.countDelivered(
          reminder.workspaceId,
          clock.localDate,
        );
      } catch {
        persistenceFailures += 1;
        continue;
      }
      if (deliveredToday >= reminder.maxPerLocalDay) {
        const nextAttemptAt = nextAllowedInstant(
          now,
          reminder.timeZone,
          quietHours,
          true,
        );
        try {
          await this.repository.defer(
            reminder,
            nextAttemptAt,
            'daily_limit',
            claimKey,
            deliveryKey,
          );
          deferred += 1;
        } catch {
          persistenceFailures += 1;
        }
        continue;
      }

      if (reminder.deliveryAttempt >= MAX_DELIVERY_ATTEMPTS) {
        try {
          await this.repository.fail(
            reminder,
            null,
            'attempt_limit',
            claimKey,
            deliveryKey,
          );
          failed += 1;
        } catch {
          persistenceFailures += 1;
        }
        continue;
      }

      try {
        await this.gateway.deliver({
          workspaceId: reminder.workspaceId,
          reminderId: reminder.id,
          title: reminder.title,
          dueAt: reminder.dueAt,
          timeZone: reminder.timeZone,
          idempotencyKey: deliveryKey,
        });
      } catch {
        try {
          await this.repository.fail(
            reminder,
            retryInstant(now, reminder.deliveryAttempt),
            'delivery_failed',
            claimKey,
            deliveryKey,
          );
          failed += 1;
        } catch {
          persistenceFailures += 1;
        }
        continue;
      }
      try {
        await this.repository.markDelivered(
          reminder,
          now.toISOString(),
          claimKey,
          deliveryKey,
        );
        delivered += 1;
      } catch {
        persistenceFailures += 1;
      }
    }

    return {
      scanned: Math.min(records.length, this.batchSize),
      delivered,
      deferred,
      failed,
      persistenceFailures,
      duplicateClaims,
      invalid,
    };
  }
}
