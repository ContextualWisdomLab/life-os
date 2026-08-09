import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  parseTodayWritePrecondition,
  requireTodayPathDate,
  toTodayHttpException,
} from './today-http';
import {
  TodayIdempotencyConflictError,
  TodayPersistenceError,
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

  it('requires a real route date identical to the body date', () => {
    expect(
      requireTodayPathDate('2026-08-09', {
        date: '2026-08-09',
      }),
    ).toBe('2026-08-09');
    for (const invalid of [
      ['2026-02-30', { date: '2026-02-30' }],
      ['2026-08-09', { date: '2026-08-10' }],
      ['2026-08-09', null],
    ] as const) {
      expect(() => requireTodayPathDate(invalid[0], invalid[1])).toThrow(
        TodayValidationError,
      );
    }
  });

  it('maps domain failures to bounded HTTP problems', () => {
    const conflict = toTodayHttpException(
      new TodayRevisionConflictError(REVISION),
    );
    expect(conflict.getStatus()).toBe(409);
    expect(conflict.getResponse()).toEqual({
      type: 'about:blank',
      title: 'Today changed on another device',
      status: 409,
      code: 'today_revision_conflict',
      currentRevision: REVISION,
    });
    expect(
      toTodayHttpException(new TodayIdempotencyConflictError()).getStatus(),
    ).toBe(409);
    expect(toTodayHttpException(new TodayValidationError()).getStatus()).toBe(
      400,
    );
    const persistence = toTodayHttpException(new TodayPersistenceError());
    expect(persistence.getStatus()).toBe(500);
    expect(persistence.getResponse()).toEqual({
      type: 'about:blank',
      title: 'Today synchronization data is unusable',
      status: 500,
      code: 'today_persistence_invalid',
    });
    expect(toTodayHttpException(new Error('database down')).getStatus()).toBe(
      503,
    );
    expect(toTodayHttpException(conflict)).toBe(conflict);
  });
});
