const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAXIMUM_TITLE_CODE_POINTS = 160;
const MAXIMUM_TITLE_BYTES = 1024;
const MAXIMUM_TIMEZONE_BYTES = 128;
const MAXIMUM_POLICY_SEARCH_MINUTES = 48 * 60;
const MINUTES_PER_DAY = 24 * 60;
const MILLISECONDS_PER_MINUTE = 60_000;
const RETRY_DELAYS_MILLISECONDS = Object.freeze([
  60_000,
  300_000,
  900_000,
  3_600_000,
  3_600_000,
]);
const REMINDER_INPUT_KEYS = new Set([
  'id',
  'workspaceId',
  'title',
  'dueAt',
  'timezone',
  'quietHours',
  'maxDeliveriesPerLocalDay',
  'maxAttempts',
  'createdAt',
]);

/** Fixed validation failure used without echoing untrusted reminder input. */
export class ReminderValidationError extends Error {
  constructor() {
    super('Reminder input is invalid');
    this.name = 'ReminderValidationError';
  }
}

/** Throws the fixed validation failure at every untrusted-input boundary. */
function invalidReminderInput() {
  throw new ReminderValidationError();
}

/** Returns true only for an ordinary object with no exotic prototype. */
function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

/** Requires an object to contain no keys outside one explicit contract. */
function requireExactKeys(value, allowedKeys) {
  if (!isPlainObject(value)) {
    return invalidReminderInput();
  }
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return invalidReminderInput();
  }
  return value;
}

/** Canonicalizes one UUIDv4 identifier to lowercase. */
export function normalizeUuidV4(value) {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidReminderInput();
  }
  return value.toLowerCase();
}

/** Canonicalizes one RFC 3339 instant to a UTC ISO timestamp. */
export function normalizeReminderTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !RFC_3339_TIMESTAMP_PATTERN.test(value)
  ) {
    return invalidReminderInput();
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    return invalidReminderInput();
  }
  return new Date(milliseconds).toISOString();
}

/** Validates and trims a bounded reminder title. */
function normalizeTitle(value) {
  if (typeof value !== 'string' || CONTROL_CHARACTER_PATTERN.test(value)) {
    return invalidReminderInput();
  }
  const normalized = value.trim();
  if (
    normalized.length === 0 ||
    [...normalized].length > MAXIMUM_TITLE_CODE_POINTS ||
    Buffer.byteLength(normalized, 'utf8') > MAXIMUM_TITLE_BYTES
  ) {
    return invalidReminderInput();
  }
  return normalized;
}

/** Creates one named-zone formatter or rejects an unsupported zone. */
function createTimeZoneFormatter(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    Buffer.byteLength(value, 'utf8') > MAXIMUM_TIMEZONE_BYTES
  ) {
    return invalidReminderInput();
  }
  try {
    return new Intl.DateTimeFormat('en-CA-u-ca-iso8601-nu-latn', {
      timeZone: value,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    return invalidReminderInput();
  }
}

/** Returns the canonical named time-zone identifier resolved by ECMA-402. */
function normalizeTimeZone(value) {
  return createTimeZoneFormatter(value).resolvedOptions().timeZone;
}

/** Parses one exact local wall-clock minute. */
function parseWallMinute(value) {
  if (typeof value !== 'string') {
    return invalidReminderInput();
  }
  const match = WALL_TIME_PATTERN.exec(value);
  if (!match) {
    return invalidReminderInput();
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    return invalidReminderInput();
  }
  return hour * 60 + minute;
}

/** Validates one already-parsed quiet-hours policy. */
function normalizeParsedQuietHours(value) {
  const policy = requireExactKeys(
    value,
    new Set(['startMinute', 'endMinute']),
  );
  const { startMinute, endMinute } = policy;
  if (
    !Number.isSafeInteger(startMinute) ||
    !Number.isSafeInteger(endMinute) ||
    startMinute < 0 ||
    startMinute >= MINUTES_PER_DAY ||
    endMinute < 0 ||
    endMinute >= MINUTES_PER_DAY ||
    startMinute === endMinute
  ) {
    return invalidReminderInput();
  }
  return Object.freeze({ startMinute, endMinute });
}

/** Parses an exact `HH:mm` quiet-hours interval into local-day minutes. */
export function parseQuietHours(value) {
  const quietHours = requireExactKeys(value, new Set(['start', 'end']));
  const startMinute = parseWallMinute(quietHours.start);
  const endMinute = parseWallMinute(quietHours.end);
  if (startMinute === endMinute) {
    return invalidReminderInput();
  }
  return Object.freeze({ startMinute, endMinute });
}

/** Requires an integer within one explicit inclusive range. */
function requireBoundedInteger(value, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidReminderInput();
  }
  return value;
}

/** Validates one Gregorian local date used for bounded policy searches. */
function normalizeLocalDate(value) {
  if (typeof value !== 'string') {
    return invalidReminderInput();
  }
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    return invalidReminderInput();
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return invalidReminderInput();
  }
  return value;
}

/** Projects epoch milliseconds through one already-validated formatter. */
function projectMilliseconds(milliseconds, formatter) {
  const parts = Object.fromEntries(
    formatter
      .formatToParts(milliseconds)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (
    !year ||
    !month ||
    !day ||
    !Number.isSafeInteger(hour) ||
    !Number.isSafeInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return invalidReminderInput();
  }
  return Object.freeze({
    localDate: `${year}-${month}-${day}`,
    minuteOfDay: hour * 60 + minute,
  });
}

/** Projects one RFC 3339 instant into a named zone's local date and minute. */
export function projectInstant(instant, timezone) {
  const canonicalInstant = normalizeReminderTimestamp(instant);
  const formatter = createTimeZoneFormatter(timezone);
  return projectMilliseconds(Date.parse(canonicalInstant), formatter);
}

/** Returns whether one local minute falls inside a half-open quiet interval. */
export function isQuietMinute(minuteOfDay, quietHours) {
  requireBoundedInteger(minuteOfDay, 0, MINUTES_PER_DAY - 1);
  if (quietHours === null) {
    return false;
  }
  const policy = normalizeParsedQuietHours(quietHours);
  if (policy.startMinute < policy.endMinute) {
    return (
      minuteOfDay >= policy.startMinute && minuteOfDay < policy.endMinute
    );
  }
  return minuteOfDay >= policy.startMinute || minuteOfDay < policy.endMinute;
}

/**
 * Finds the first actual minute after an instant that satisfies local-day and
 * quiet-hours policy, scanning a hard 48-hour horizon through real instants.
 */
export function findNextPolicyInstant({
  after,
  timezone,
  quietHours,
  minimumLocalDateExclusive,
}) {
  const canonicalAfter = normalizeReminderTimestamp(after);
  const formatter = createTimeZoneFormatter(timezone);
  const policy =
    quietHours === null ? null : normalizeParsedQuietHours(quietHours);
  const minimumDate =
    minimumLocalDateExclusive === undefined
      ? undefined
      : normalizeLocalDate(minimumLocalDateExclusive);
  const firstCandidate =
    Math.floor(Date.parse(canonicalAfter) / MILLISECONDS_PER_MINUTE) *
      MILLISECONDS_PER_MINUTE +
    MILLISECONDS_PER_MINUTE;

  for (let offset = 0; offset < MAXIMUM_POLICY_SEARCH_MINUTES; offset += 1) {
    const candidate = firstCandidate + offset * MILLISECONDS_PER_MINUTE;
    const projection = projectMilliseconds(candidate, formatter);
    const afterRequiredDate =
      minimumDate === undefined || projection.localDate > minimumDate;
    if (
      afterRequiredDate &&
      (policy === null || !isQuietMinute(projection.minuteOfDay, policy))
    ) {
      return new Date(candidate).toISOString();
    }
  }
  return invalidReminderInput();
}

/** Returns the fixed retry delay for one bounded one-based attempt number. */
export function retryDelayMilliseconds(attemptNumber) {
  const attempt = requireBoundedInteger(
    attemptNumber,
    1,
    RETRY_DELAYS_MILLISECONDS.length,
  );
  return RETRY_DELAYS_MILLISECONDS[attempt - 1];
}

/** Creates one immutable canonical reminder aggregate. */
export function createReminder(value) {
  const input = requireExactKeys(value, REMINDER_INPUT_KEYS);
  const dueAt = normalizeReminderTimestamp(input.dueAt);
  const quietHours =
    input.quietHours === undefined || input.quietHours === null
      ? null
      : parseQuietHours(input.quietHours);
  const maxDeliveriesPerLocalDay =
    input.maxDeliveriesPerLocalDay === undefined
      ? 3
      : requireBoundedInteger(input.maxDeliveriesPerLocalDay, 1, 10);
  const maxAttempts =
    input.maxAttempts === undefined
      ? 3
      : requireBoundedInteger(input.maxAttempts, 1, 5);

  return Object.freeze({
    id: normalizeUuidV4(input.id),
    workspaceId: normalizeUuidV4(input.workspaceId),
    title: normalizeTitle(input.title),
    dueAt,
    timezone: normalizeTimeZone(input.timezone),
    quietHours,
    maxDeliveriesPerLocalDay,
    maxAttempts,
    createdAt: normalizeReminderTimestamp(input.createdAt),
    status: 'pending',
    attemptCount: 0,
    nextEligibleAt: dueAt,
  });
}
