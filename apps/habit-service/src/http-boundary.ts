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

function invalidRequest(): never {
  throw problemException(400, 'Habit request is invalid', 'invalid_request');
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidRequest();
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    return invalidRequest();
  }
  return value.trim();
}

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

function requireUuidV4(value: unknown): string {
  const text = requireString(value);
  if (!UUID_V4_PATTERN.test(text)) {
    return invalidRequest();
  }
  return text.toLowerCase();
}

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

/** Requires a tenant UUIDv4 exclusively from the trusted workspace header. */
export function requireWorkspaceId(value: string | undefined): string {
  try {
    return requireUuidV4(value);
  } catch {
    throw problemException(
      400,
      'A valid x-workspace-id header is required',
      'invalid_workspace',
    );
  }
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
