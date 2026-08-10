import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { HabitRecurrence, IsoWeekday } from './habit-domain';
import {
  HabitIdempotencyConflictError,
  HabitPersistenceError,
} from './postgres-habit-repository';

/** Bounded problem-details response returned by the Habit HTTP boundary. */
export interface HabitProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

/** Headers emitted by the trusted gateway after authenticating a workspace. */
export interface TrustedHabitWorkspaceContextHeaders {
  workspaceId: unknown;
  issuedAt: unknown;
  signature: unknown;
}

/** Validated create-habit command accepted by the Habit domain service. */
export interface CreateHabitRequest {
  title: string;
  timezone: string;
  startsOn: string;
  recurrence: HabitRecurrence;
}

/** Validated completion command accepted by the Habit domain service. */
export interface CompleteHabitRequest {
  scheduledLocalDate: string;
  completedAt: string;
  idempotencyKey: string;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
const VALIDATION_MESSAGES = new Set([
  'Identifier must be an opaque non-numeric string',
  'Title is required',
  'Timezone is required',
  'Timezone is invalid',
  'Recurrence interval must be between 1 and 365',
  'Weekly recurrence requires at least one weekday',
  'Weekday must be between 1 and 7',
  'Recurrence kind is invalid',
  'Local date must use YYYY-MM-DD',
  'Local date is invalid',
  'Timestamp is invalid',
  'Idempotency key must be a UUIDv4',
  'Occurrence range is reversed',
  'Occurrence range exceeds 366 days',
  'Habit is not scheduled on this date',
]);

/** Builds a stable credential-free Habit problem response. */
function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const problem: HabitProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

/** Rejects malformed, stale, future-dated, or forged gateway context. */
function invalidGatewayContext(): never {
  throw problemException(
    401,
    'Trusted gateway context is invalid',
    'invalid_gateway_context',
  );
}

/** Rejects requests when Habit cannot verify gateway authenticity. */
function unavailableGatewayContext(): never {
  throw problemException(
    503,
    'Trusted gateway context is unavailable',
    'gateway_context_unavailable',
  );
}

/** Computes the versioned workspace digest shared by gateway and Habit. */
function workspaceContextDigest(
  workspaceId: string,
  issuedAt: string,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(`life-os.workspace.v1\n${workspaceId}\n${issuedAt}`, 'utf8')
    .digest();
}

/**
 * Verifies a short-lived signed workspace context before Habit domain access.
 * A bare client-selected workspace header is intentionally not an authority.
 */
export function requireTrustedWorkspaceContext(
  headers: TrustedHabitWorkspaceContextHeaders,
  secret: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES
  ) {
    return unavailableGatewayContext();
  }
  if (
    typeof headers.workspaceId !== 'string' ||
    typeof headers.issuedAt !== 'string' ||
    typeof headers.signature !== 'string' ||
    !UUID_V4_PATTERN.test(headers.workspaceId) ||
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return invalidGatewayContext();
  }

  const workspaceId = headers.workspaceId.toLowerCase();
  const issuedAtSeconds = Number(headers.issuedAt);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS ||
    issuedAtSeconds < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS
  ) {
    return invalidGatewayContext();
  }

  const expected = workspaceContextDigest(
    workspaceId,
    headers.issuedAt,
    secret,
  );
  const actual = Buffer.from(headers.signature, 'base64url');
  if (!timingSafeEqual(actual, expected)) {
    return invalidGatewayContext();
  }
  return workspaceId;
}

/** Produces the shared validation problem for malformed request content. */
function invalidRequest(): never {
  throw problemException(400, 'Habit request is invalid', 'invalid_request');
}

/** Requires a JSON object rather than an array or primitive. */
function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidRequest();
  }
  return value as Record<string, unknown>;
}

/** Requires one nonblank string and trims surrounding whitespace. */
function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return invalidRequest();
  }
  return value.trim();
}

/** Requires one safe integer inside an inclusive range. */
function requireInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidRequest();
  }
  return value;
}

/** Requires one exact allowlisted set of object keys. */
function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): void {
  const expected = new Set(keys);
  const actual = Object.keys(record);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    invalidRequest();
  }
}

/** Requires a real Gregorian calendar date in YYYY-MM-DD form. */
function requireLocalDate(value: unknown): string {
  const text = requireString(value);
  const match = LOCAL_DATE_PATTERN.exec(text);
  if (!match) {
    return invalidRequest();
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return invalidRequest();
  }
  return text;
}

/** Requires an RFC 3339 timestamp and returns a canonical UTC instant. */
function requireTimestamp(value: unknown): string {
  const text = requireString(value);
  if (!RFC_3339_TIMESTAMP_PATTERN.test(text)) {
    return invalidRequest();
  }
  const timestamp = new Date(text);
  if (Number.isNaN(timestamp.getTime())) {
    return invalidRequest();
  }
  return timestamp.toISOString();
}

/** Requires one canonical lower-case UUIDv4 identifier. */
function requireUuidV4(value: unknown): string {
  const text = requireString(value);
  if (!UUID_V4_PATTERN.test(text)) {
    return invalidRequest();
  }
  return text.toLowerCase();
}

/** Parses one daily or weekly recurrence command. */
function parseRecurrence(value: unknown): HabitRecurrence {
  const recurrence = requireRecord(value);
  if (recurrence.kind === 'daily') {
    requireExactKeys(recurrence, ['kind', 'interval']);
    return {
      kind: 'daily',
      interval: requireInteger(recurrence.interval, 1, 365),
    };
  }
  if (recurrence.kind === 'weekly') {
    requireExactKeys(recurrence, ['kind', 'interval', 'weekdays']);
    if (
      !Array.isArray(recurrence.weekdays) ||
      recurrence.weekdays.length === 0
    ) {
      return invalidRequest();
    }
    const weekdays = recurrence.weekdays.map((weekday) =>
      requireInteger(weekday, 1, 7),
    );
    return {
      kind: 'weekly',
      interval: requireInteger(recurrence.interval, 1, 365),
      weekdays: weekdays as IsoWeekday[],
    };
  }
  return invalidRequest();
}

/** Requires a UUIDv4 path identifier before reaching persistence. */
export function requireHabitId(value: string): string {
  try {
    return requireUuidV4(value);
  } catch {
    throw problemException(400, 'Habit identifier is invalid', 'invalid_habit');
  }
}

/** Requires and validates one local-date query value. */
export function requireLocalDateQuery(
  value: string | undefined,
  name: 'from' | 'to',
): string {
  try {
    return requireLocalDate(value);
  } catch {
    throw problemException(
      400,
      `The ${name} local date is invalid`,
      'invalid_date_range',
    );
  }
}

/** Parses an exact create-habit body without accepting tenant ownership. */
export function parseCreateHabitRequest(body: unknown): CreateHabitRequest {
  const record = requireRecord(body);
  requireExactKeys(record, ['title', 'timezone', 'startsOn', 'recurrence']);
  return {
    title: requireString(record.title),
    timezone: requireString(record.timezone),
    startsOn: requireLocalDate(record.startsOn),
    recurrence: parseRecurrence(record.recurrence),
  };
}

/** Parses an exact append-only completion command. */
export function parseCompleteHabitRequest(body: unknown): CompleteHabitRequest {
  const record = requireRecord(body);
  requireExactKeys(record, [
    'scheduledLocalDate',
    'completedAt',
    'idempotencyKey',
  ]);
  return {
    scheduledLocalDate: requireLocalDate(record.scheduledLocalDate),
    completedAt: requireTimestamp(record.completedAt),
    idempotencyKey: requireUuidV4(record.idempotencyKey),
  };
}

/** Maps domain and persistence failures to credential-free HTTP problems. */
export function toHabitHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  if (error instanceof HabitIdempotencyConflictError) {
    return problemException(
      409,
      'Completion idempotency key conflicts with an earlier command',
      'idempotency_conflict',
    );
  }
  if (error instanceof Error && error.message === 'Habit not found') {
    return problemException(404, 'Habit not found', 'not_found');
  }
  if (error instanceof Error && VALIDATION_MESSAGES.has(error.message)) {
    return problemException(400, 'Habit request is invalid', 'invalid_request');
  }
  if (error instanceof HabitPersistenceError) {
    return problemException(
      503,
      'Habit persistence is unavailable',
      'persistence_unavailable',
    );
  }
  return problemException(
    503,
    'Habit service is unavailable',
    'service_unavailable',
  );
}
