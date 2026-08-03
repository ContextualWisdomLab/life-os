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

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw problemException(400, 'Habit request is invalid', 'invalid_request');
  }
  return value as Record<string, unknown>;
}

function requireString(
  record: Record<string, unknown>,
  name: string,
): string {
  const value = record[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw problemException(400, 'Habit request is invalid', 'invalid_request');
  }
  return value.trim();
}

function requireInteger(
  record: Record<string, unknown>,
  name: string,
): number {
  const value = record[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw problemException(400, 'Habit request is invalid', 'invalid_request');
  }
  return value;
}

function parseRecurrence(value: unknown): HabitRecurrence {
  const recurrence = requireRecord(value);
  const kind = requireString(recurrence, 'kind');
  const interval = requireInteger(recurrence, 'interval');
  if (kind === 'daily') {
    if (recurrence.weekdays !== undefined) {
      throw problemException(400, 'Habit request is invalid', 'invalid_request');
    }
    return { kind, interval };
  }
  if (kind === 'weekly') {
    if (!Array.isArray(recurrence.weekdays)) {
      throw problemException(400, 'Habit request is invalid', 'invalid_request');
    }
    const weekdays = recurrence.weekdays.map((weekday) => {
      if (
        typeof weekday !== 'number' ||
        !Number.isSafeInteger(weekday) ||
        weekday < 1 ||
        weekday > 7
      ) {
        throw problemException(
          400,
          'Habit request is invalid',
          'invalid_request',
        );
      }
      return weekday as IsoWeekday;
    });
    return { kind, interval, weekdays };
  }
  throw problemException(400, 'Habit request is invalid', 'invalid_request');
}

/** Requires a tenant UUIDv4 exclusively from the trusted workspace header. */
export function requireWorkspaceId(value: string | undefined): string {
  const workspaceId = value?.trim();
  if (!workspaceId || !UUID_V4_PATTERN.test(workspaceId)) {
    throw problemException(
      400,
      'A valid x-workspace-id header is required',
      'invalid_workspace',
    );
  }
  return workspaceId.toLowerCase();
}

/** Requires a UUIDv4 path identifier before reaching persistence. */
export function requireHabitId(value: string): string {
  const habitId = value.trim();
  if (!UUID_V4_PATTERN.test(habitId)) {
    throw problemException(400, 'Habit identifier is invalid', 'invalid_habit');
  }
  return habitId.toLowerCase();
}

/** Requires a nonblank local-date query value for domain validation. */
export function requireLocalDateQuery(
  value: string | undefined,
  name: 'from' | 'to',
): string {
  const date = value?.trim();
  if (!date) {
    throw problemException(
      400,
      `The ${name} local date is required`,
      'invalid_date_range',
    );
  }
  return date;
}

/** Parses an untrusted create-habit body without accepting tenant ownership. */
export function parseCreateHabitRequest(body: unknown): CreateHabitRequest {
  const record = requireRecord(body);
  return {
    title: requireString(record, 'title'),
    timezone: requireString(record, 'timezone'),
    startsOn: requireString(record, 'startsOn'),
    recurrence: parseRecurrence(record.recurrence),
  };
}

/** Parses an untrusted append-only completion command. */
export function parseCompleteHabitRequest(body: unknown): CompleteHabitRequest {
  const record = requireRecord(body);
  return {
    scheduledLocalDate: requireString(record, 'scheduledLocalDate'),
    completedAt: requireString(record, 'completedAt'),
    idempotencyKey: requireString(record, 'idempotencyKey'),
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
  return problemException(500, 'Habit service failed', 'internal_error');
}
