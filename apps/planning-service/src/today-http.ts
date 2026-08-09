import { HttpException } from '@nestjs/common';
import {
  canonicalTodayDate,
  canonicalTodayUuidV4,
} from './today-invariants';
import {
  TodayIdempotencyConflictError,
  TodayPersistenceError,
  TodayRevisionConflictError,
  TodayValidationError,
  type TodayWritePrecondition,
} from './today-sync';

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

/** Throws the shared domain validation error for malformed request content. */
function invalidTodayRequest(): never {
  throw new TodayValidationError();
}

/** Throws the stable HTTP problem for malformed conditional headers. */
function invalidTodayPrecondition(): never {
  throw problem(
    400,
    'Today write preconditions are invalid',
    'invalid_today_precondition',
  );
}

/** Requires a real calendar date and exact agreement between route and body. */
export function requireTodayPathDate(
  routeDate: unknown,
  body: unknown,
): string {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    (body as Record<string, unknown>).date !== routeDate
  ) {
    throw new TodayValidationError();
  }
  return canonicalTodayDate(routeDate, invalidTodayRequest);
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
    return invalidTodayPrecondition();
  }
  if (ifNoneMatch !== undefined) {
    if (ifNoneMatch !== '*') return invalidTodayPrecondition();
    return Object.freeze({ kind: 'absent' });
  }
  const match = /^"([^"\r\n]+)"$/u.exec(ifMatch ?? '');
  if (!match?.[1]) return invalidTodayPrecondition();
  return Object.freeze({
    kind: 'match',
    revision: canonicalTodayUuidV4(match[1], invalidTodayPrecondition),
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
