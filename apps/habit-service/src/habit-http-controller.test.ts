import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { HabitService, InMemoryHabitRepository } from './habit-domain';
import { HabitController } from './habit-http-controller';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const IDEMPOTENCY_KEY = '22222222-2222-4222-8222-222222222222';

function controller(): HabitController {
  return new HabitController(
    new HabitService(new InMemoryHabitRepository()),
  );
}

describe('HabitController', () => {
  it('exposes the durable habit workflow through validated methods', async () => {
    const boundary = controller();
    const habit = await boundary.createHabit(WORKSPACE_ID, {
      title: 'Morning walk',
      timezone: 'Asia/Seoul',
      startsOn: '2026-08-04',
      recurrence: { kind: 'daily', interval: 1 },
    });

    await expect(boundary.listHabits(WORKSPACE_ID)).resolves.toEqual([habit]);
    await expect(
      boundary.listOccurrences(
        WORKSPACE_ID,
        habit.id,
        '2026-08-04',
        '2026-08-05',
      ),
    ).resolves.toEqual([
      {
        habitId: habit.id,
        workspaceId: WORKSPACE_ID,
        scheduledLocalDate: '2026-08-04',
      },
      {
        habitId: habit.id,
        workspaceId: WORKSPACE_ID,
        scheduledLocalDate: '2026-08-05',
      },
    ]);

    const completion = await boundary.completeHabit(WORKSPACE_ID, habit.id, {
      scheduledLocalDate: '2026-08-04',
      completedAt: '2026-08-04T08:00:00.000Z',
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    const replay = await boundary.completeHabit(WORKSPACE_ID, habit.id, {
      scheduledLocalDate: '2026-08-04',
      completedAt: '2026-08-04T08:00:00.000Z',
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(replay).toEqual(completion);
    await expect(
      boundary.listCompletionHistory(WORKSPACE_ID, habit.id),
    ).resolves.toEqual([completion]);
  });

  it('does not expose another workspace habit', async () => {
    const boundary = controller();
    const habit = await boundary.createHabit(WORKSPACE_ID, {
      title: 'Private habit',
      timezone: 'UTC',
      startsOn: '2026-08-04',
      recurrence: { kind: 'daily', interval: 1 },
    });

    await expect(
      boundary.listOccurrences(
        OTHER_WORKSPACE_ID,
        habit.id,
        '2026-08-04',
        '2026-08-04',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('maps malformed input to problem details', async () => {
    const boundary = controller();

    try {
      await boundary.createHabit(WORKSPACE_ID, {
        title: 'Habit',
        timezone: 'UTC',
        startsOn: '2026-08-04',
        recurrence: { kind: 'weekly', interval: 1, weekdays: [] },
      });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(400);
      expect(exception.getResponse()).toEqual({
        type: 'about:blank',
        title: 'Habit request is invalid',
        status: 400,
        code: 'invalid_request',
      });
    }
  });
});
