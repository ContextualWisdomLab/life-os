import { describe, expect, it } from 'vitest';
import { HabitService, InMemoryHabitRepository } from './habit-domain';

const COMPLETION_KEY = '11111111-1111-4111-8111-111111111111';

describe('Habit Today status', () => {
  it('returns only scheduled habits with completion evidence for one workspace and date', async () => {
    const service = new HabitService(new InMemoryHabitRepository());
    const scheduled = await service.createHabit('workspace-a', {
      title: 'Walk deliberately',
      timezone: 'Asia/Seoul',
      startsOn: '2026-08-10',
      recurrence: { kind: 'daily', interval: 1 },
    });
    await service.createHabit('workspace-a', {
      title: 'Every other day',
      timezone: 'Asia/Seoul',
      startsOn: '2026-08-09',
      recurrence: { kind: 'daily', interval: 2 },
    });
    await service.createHabit('workspace-b', {
      title: 'Other tenant habit',
      timezone: 'Asia/Seoul',
      startsOn: '2026-08-10',
      recurrence: { kind: 'daily', interval: 1 },
    });
    const completion = await service.completeHabit('workspace-a', scheduled.id, {
      scheduledLocalDate: '2026-08-10',
      completedAt: '2026-08-10T08:00:00.000Z',
      idempotencyKey: COMPLETION_KEY,
    });

    await expect(
      service.listTodayHabits('workspace-a', '2026-08-10'),
    ).resolves.toEqual([
      {
        habitId: scheduled.id,
        title: 'Walk deliberately',
        scheduledLocalDate: '2026-08-10',
        completed: true,
        completionId: completion.id,
      },
    ]);
  });

  it('reports scheduled incomplete habits without fabricating a completion id', async () => {
    const service = new HabitService(new InMemoryHabitRepository());
    const scheduled = await service.createHabit('workspace-a', {
      title: 'Read carefully',
      timezone: 'UTC',
      startsOn: '2026-08-10',
      recurrence: { kind: 'daily', interval: 1 },
    });

    await expect(
      service.listTodayHabits('workspace-a', '2026-08-10'),
    ).resolves.toEqual([
      {
        habitId: scheduled.id,
        title: 'Read carefully',
        scheduledLocalDate: '2026-08-10',
        completed: false,
      },
    ]);
  });
});
