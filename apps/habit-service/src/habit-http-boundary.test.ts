import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  parseCompleteHabitRequest,
  parseCreateHabitRequest,
  parseOccurrenceRange,
  requireHabitId,
  requireWorkspaceId,
  toHabitHttpException,
} from './habit-http-boundary';
import {
  HabitIdempotencyConflictError,
  HabitPersistenceError,
} from './postgres-habit-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const HABIT_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333';

function responseOf(exception: HttpException): unknown {
  return exception.getResponse();
}

describe('Habit HTTP boundary', () => {
  it('parses exact daily and weekly create requests', () => {
    expect(
      parseCreateHabitRequest({
        title: '  Morning walk  ',
        timezone: 'Asia/Seoul',
        startsOn: '2026-08-04',
        recurrence: { kind: 'daily', interval: 2 },
      }),
    ).toEqual({
      title: 'Morning walk',
      timezone: 'Asia/Seoul',
      startsOn: '2026-08-04',
      recurrence: { kind: 'daily', interval: 2 },
    });
    expect(
      parseCreateHabitRequest({
        title: 'Review',
        timezone: 'UTC',
        startsOn: '2026-08-04',
        recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 5] },
      }),
    ).toMatchObject({
      recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 5] },
    });
  });

  it('rejects unknown fields and malformed discriminators', () => {
    for (const value of [
      {
        title: 'Habit',
        timezone: 'UTC',
        startsOn: '2026-08-04',
        recurrence: { kind: 'monthly', interval: 1 },
      },
      {
        title: 'Habit',
        timezone: 'UTC',
        startsOn: '2026-08-04',
        recurrence: { kind: 'daily', interval: 1 },
        unexpected: true,
      },
    ]) {
      expect(() => parseCreateHabitRequest(value)).toThrowError(HttpException);
    }
  });

  it('parses UUID-scoped completion and occurrence inputs', () => {
    expect(requireWorkspaceId(WORKSPACE_ID)).toBe(WORKSPACE_ID);
    expect(requireHabitId(HABIT_ID)).toBe(HABIT_ID);
    expect(parseOccurrenceRange('2026-08-04', '2026-08-10')).toEqual({
      from: '2026-08-04',
      to: '2026-08-10',
    });
    expect(
      parseCompleteHabitRequest({
        scheduledLocalDate: '2026-08-04',
        completedAt: '2026-08-04T08:00:00.000Z',
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).toEqual({
      scheduledLocalDate: '2026-08-04',
      completedAt: '2026-08-04T08:00:00.000Z',
      idempotencyKey: IDEMPOTENCY_KEY,
    });
  });

  it('maps conflicts, not-found, validation, and persistence failures', () => {
    expect(
      responseOf(toHabitHttpException(new HabitIdempotencyConflictError())),
    ).toEqual({
      type: 'about:blank',
      title: 'Completion idempotency key conflicts with an existing event',
      status: 409,
      code: 'idempotency_conflict',
    });
    expect(
      responseOf(toHabitHttpException(new Error('Habit not found'))),
    ).toEqual({
      type: 'about:blank',
      title: 'Habit not found',
      status: 404,
      code: 'not_found',
    });
    expect(
      responseOf(toHabitHttpException(new Error('Timezone is invalid'))),
    ).toEqual({
      type: 'about:blank',
      title: 'Habit request is invalid',
      status: 400,
      code: 'invalid_request',
    });
    expect(
      responseOf(toHabitHttpException(new HabitPersistenceError())),
    ).toEqual({
      type: 'about:blank',
      title: 'Habit persistence is unavailable',
      status: 503,
      code: 'persistence_unavailable',
    });
  });

  it('does not expose unexpected error contents', () => {
    const exception = toHabitHttpException(
      new Error('password=secret SELECT * FROM habit.completion_events'),
    );
    const response = JSON.stringify(responseOf(exception));
    expect(exception.getStatus()).toBe(503);
    expect(response).not.toContain('secret');
    expect(response).not.toContain('SELECT');
  });
});
