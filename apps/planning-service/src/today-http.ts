import { HttpException } from '@nestjs/common';
import { TodayPersistenceError } from './postgres-today-repository';
import {
  TodayIdempotencyConflictError,
  TodayRevisionConflictError,
  TodayValidationError,
  type TodayWritePrecondition,
} from './today-sync';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** Bounded RFC 9457-compatible problem object for Today synchronization. */
interface TodayProblem {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly currentRevision?: string | null;
}

/** Creates one credential-free Today problem response. */
function problem(
  status: number,
  title: string,
  code: string,
  currentRevision?: string | null,
): HttpException {
  const body: TodayProblem = {
    type: 'about:blank',
    title,
    status,
    code,
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
  return new HttpException(body, status);
}

/** Requires a real calendar date and exact agreement between route and body. */
export function requireTodayPathDate(
  routeDate: unknown,
  body: unknown,
): string {
  if (
    typeof routeDate !== 'string' ||
    !DATE_PATTERN.test(routeDate) ||
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).date !== routeDate
  ) {
    throw new TodayValidationError();
  }
  const parsed = new Date(`${routeDate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== routeDate
  ) {
    throw new TodayValidationError();
  }
  return routeDate;
}

/**
 * Converts HTTP conditional headers into the domain's explicit create/update
 * precondition without accepting weak, list, wildcard-update, or unquoted tags.
 */
export function parseTodayWritePrecondition(
  ifMatch: string | undefined,
  ifNoneMatch: string | undefined,
): TodayWritePrecondition {
  if (ifMatch === undefined && ifNoneMatch === undefined) {
    throw problem(
      428,
      'A Today write precondition is required',
      'today_precondition_required',
    );
  }
  if (ifMatch !== undefined && ifNoneMatch !== undefined) {
    throw problem(
      400,
      'Today write preconditions are invalid',
      'invalid_today_precondition',
    );
  }
  if (ifNoneMatch !== undefined) {
    if (ifNoneMatch !== '*') {
      throw problem(
        400,
        'Today write preconditions are invalid',
        'invalid_today_precondition',
      );
    }
    return Object.freeze({ kind: 'absent' });
  }
  const match = /^"([0-9a-f-]+)"$/iu.exec(ifMatch ?? '');
  if (!match?.[1] || !UUID_V4_PATTERN.test(match[1])) {
    throw problem(
      400,
      'Today write preconditions are invalid',
      'invalid_today_precondition',
    );
  }
  return Object.freeze({
    kind: 'match',
    revision: match[1].toLowerCase(),
  });
}

/** Maps Today domain/persistence failures to stable credential-free HTTP errors. */
export function toTodayHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  if (error instanceof TodayRevisionConflictError) {
    return problem(
      409,
      'Today changed on another device',
      'today_revision_conflict',
      error.currentRevision,
    );
  }
  if (error instanceof TodayIdempotencyConflictError) {
    return problem(
      409,
      'Today idempotency key conflicts with an earlier request',
      'today_idempotency_conflict',
    );
  }
  if (error instanceof TodayValidationError) {
    return problem(
      400,
      'Today synchronization request is invalid',
      'invalid_today_request',
    );
  }
  if (error instanceof TodayPersistenceError) {
    return problem(
      500,
      'Today synchronization data is unusable',
      'today_persistence_invalid',
    );
  }
  return problem(
    503,
    'Today synchronization is unavailable',
    'today_sync_unavailable',
  );
}
