import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  parseTodayWritePrecondition,
  requireTodayPathDate,
  toTodayHttpException,
} from './today-http';
import { TodayPersistenceError } from './postgres-today-repository';
import {
  TodayIdempotencyConflictError,
  TodayRevisionConflictError,
  TodayValidationError,
} from './today-sync';

const REVISION = '33333333-3333-4333-8333-333333333333';

describe('Today HTTP boundary', () => {
  it('uses If-None-Match star only for an explicit create and quoted If-Match for update', () => {
    expect(parseTodayWritePrecondition(undefined, '*')).toEqual({
      kind: 'absent',
    });
    expect(parseTodayWritePrecondition(`"${REVISION}"`, undefined)).toEqual({
      kind: 'match',
      revision: REVISION,
    });
  });

  it('requires exactly one valid conditional request header', () => {
    for (const [ifMatch, ifNoneMatch] of [
      [undefined, undefined],
      [`"${REVISION}"`, '*'],
      [REVISION, undefined],
      ['*', undefined],
      [`W/"${REVISION}"`, undefined],
      [`"${REVISION}", "${REVISION}"`, undefined],
      [undefined, '"anything"'],
    ] as const) {
      expect(() => parseTodayWritePrecondition(ifMatch, ifNoneMatch)).toThrow(
        HttpException,
      );
    }
  });

  it('binds the route date to the complete aggregate body', () => {
    expect(requireTodayPathDate('2026-08-09', { date: '2026-08-09' })).toBe(
      '2026-08-09',
    );
    expect(() =>
      requireTodayPathDate('2026-08-09', { date: '2026-08-10' }),
    ).toThrow(TodayValidationError);
    expect(() => requireTodayPathDate('not-a-date', { date: 'not-a-date' })).toThrow(
      TodayValidationError,
    );
  });

  it('maps stale writes to bounded conflicts containing only the current revision', () => {
    const exception = toTodayHttpException(new TodayRevisionConflictError(REVISION));

    expect(exception.getStatus()).toBe(409);
    expect(exception.getResponse()).toEqual({
      type: 'about:blank',
      title: 'Today changed on another device',
      status: 409,
      code: 'today_revision_conflict',
      currentRevision: REVISION,
    });
  });

  it('maps persistence corruption separately from retryable dependency failures', () => {
    expect(toTodayHttpException(new TodayPersistenceError()).getResponse()).toEqual({
      type: 'about:blank',
      title: 'Today synchronization data is unusable',
      status: 500,
      code: 'today_persistence_invalid',
    });
    expect(toTodayHttpException(new Error('database password')).getResponse()).toEqual({
      type: 'about:blank',
      title: 'Today synchronization is unavailable',
      status: 503,
      code: 'today_sync_unavailable',
    });
  });

  it('maps validation and conflicting idempotency reuse without leaking request data', () => {
    expect(toTodayHttpException(new TodayValidationError()).getStatus()).toBe(400);
    expect(
      toTodayHttpException(new TodayIdempotencyConflictError()).getResponse(),
    ).toEqual({
      type: 'about:blank',
      title: 'Today idempotency key conflicts with an earlier request',
      status: 409,
      code: 'today_idempotency_conflict',
    });
  });
});
