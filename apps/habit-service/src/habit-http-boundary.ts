import { HttpException } from '@nestjs/common';
import type { HabitRecurrence, IsoWeekday } from './habit-domain';
import {
  HabitIdempotencyConflictError,
  HabitPersistenceError,
} from './postgres-habit-repository';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export interface HabitProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

export interface CreateHabitRequest {
  title: string;
  timezone: string;
  startsOn: string;
  recurrence: HabitRecurrence;
}

export interface CompleteHabitRequest {
  scheduledLocalDate: string;
  completedAt: string;
  idempotencyKey: string;
}

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

function requireUuidV4(value: unknown): string {
  const text = requireString(value);
  if (!UUID_V4_PATTERN.test(text)) {
    return invalidRequest();
  }
  return text.toLowerCase();
}

function requireLocalDate(value: unknown): string {
  const text = requireString(value);
  if (!LOCAL_DATE_PATTERN.test(text)) {
    return invalidRequest();
  }
  return text;
}

function requireTimestamp(value: unknown): string {
  const text = requireString(value);
  if (!RFC_3339_TIMESTAMP_PATTERN.test(text)) {
    return invalidRequest();
  }
  return text;
}

function requireExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): void {
  const expected = new Set(keys);
  if (
    Object.keys(record).length !== expected.size ||
    Object.keys(record).some((key) => !expected.has(key))
  ) {
    invalidRequest();
  }
}

function parseRecurrence(value: unknown): HabitRecurrence {
  const record = requireRecord(value);
  const kind = record.kind;
  if (kind === 'daily') {
    requireExactKeys(record, ['kind', 'interval']);
    return {
      kind,
      interval: requireInteger(record.interval, 1, 365),
    };
  }
  if (kind === 'weekly') {
    requireExactKeys(record, ['kind', 'interval', 'weekdays']);
    if (!Array.isArray(record.weekdays) || record.weekdays.length === 0) {
      return invalidRequest();
    }
    const weekdays = record.weekdays.map((weekday) =>
      requireInteger(weekday, 1, 7),
    );
    return {
      kind,
      interval: requireInteger(record.interval, 1, 365),
      weekdays: weekdays as IsoWeekday[],
    };
  }
  return invalidRequest();
}

export function requireWorkspaceId(value: unknown): string {
  return requireUuidV4(value);
}

export function requireHabitId(value: unknown): string {
  return requireUuidV4(value);
}

export function parseCreateHabitRequest(value: unknown): CreateHabitRequest {
  const record = requireRecord(value);
  requireExactKeys(record, ['title', 'timezone', 'startsOn', 'recurrence']);
  return {
    title: requireString(record.title),
    timezone: requireString(record.timezone),
    startsOn: requireLocalDate(record.startsOn),
    recurrence: parseRecurrence(record.recurrence),
  };
}

export function parseCompleteHabitRequest(
  value: unknown,
): CompleteHabitRequest {
  const record = requireRecord(value);
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

export function parseOccurrenceRange(
  from: unknown,
  to: unknown,
): { from: string; to: string } {
  return {
    from: requireLocalDate(from),
    to: requireLocalDate(to),
  };
}

const VALIDATION_MESSAGES = new Set([
  'Identifier must be an opaque non-numeric string',
  'Title is required',
  'Timezone is required',
  'Timezone is invalid',
  'Local date must use YYYY-MM-DD',
  'Local date is invalid',
  'Recurrence interval must be between 1 and 365',
  'Weekly recurrence requires at least one weekday',
  'Weekday must be between 1 and 7',
  'Occurrence range is reversed',
  'Occurrence range exceeds 366 days',
  'Timestamp is invalid',
  'Idempotency key must be a UUIDv4',
  'Habit is not scheduled on this date',
]);

export function toHabitHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  if (error instanceof HabitIdempotencyConflictError) {
    return problemException(
      409,
      'Completion idempotency key conflicts with an existing event',
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
