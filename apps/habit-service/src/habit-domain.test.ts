import { describe, expect, it } from 'vitest';
import {
  HabitService,
  InMemoryHabitRepository,
  generateHabitOccurrences,
  type Habit,
  type IsoWeekday,
} from './habit-domain';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIRST_IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111';

function dailyHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    workspaceId: 'workspace-a',
    title: 'Read deliberately',
    timezone: 'Asia/Seoul',
    startsOn: '2024-02-28',
    recurrence: { kind: 'daily', interval: 2 },
    createdAt: '2024-02-28T00:00:00.000Z',
    ...overrides,
  };
}

describe('habit recurrence kernel', () => {
  it('recovers an every-two-days schedule across leap day and month end', () => {
    const occurrences = generateHabitOccurrences(
      dailyHabit(),
      '2024-02-27',
      '2024-03-04',
    );

    expect(
      occurrences.map((occurrence) => occurrence.scheduledLocalDate),
    ).toEqual(['2024-02-28', '2024-03-01', '2024-03-03']);
  });

  it('generates weekly local-date occurrences without DST-hour drift', () => {
    const habit: Habit = {
      ...dailyHabit(),
      startsOn: '2026-03-01',
      timezone: 'America/New_York',
      recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 5] },
    };

    const occurrences = generateHabitOccurrences(
      habit,
      '2026-03-01',
      '2026-03-15',
    );

    expect(
      occurrences.map((occurrence) => occurrence.scheduledLocalDate),
    ).toEqual(['2026-03-02', '2026-03-06', '2026-03-09', '2026-03-13']);
  });

  it('anchors multi-week intervals to the ISO week containing the start date', () => {
    const habit: Habit = {
      ...dailyHabit(),
      startsOn: '2026-01-07',
      recurrence: { kind: 'weekly', interval: 2, weekdays: [1] },
    };

    const occurrences = generateHabitOccurrences(
      habit,
      '2026-01-07',
      '2026-02-02',
    );

    expect(
      occurrences.map((occurrence) => occurrence.scheduledLocalDate),
    ).toEqual(['2026-01-19', '2026-02-02']);
  });

  it('keeps interval schedules stable across year boundaries', () => {
    const habit: Habit = {
      ...dailyHabit(),
      startsOn: '2026-12-28',
      recurrence: { kind: 'weekly', interval: 2, weekdays: [1, 3] },
    };

    const first = generateHabitOccurrences(habit, '2026-12-28', '2027-01-25');
    const second = generateHabitOccurrences(habit, '2026-12-28', '2027-01-25');

    expect(first).toEqual(second);
    expect(first.map((occurrence) => occurrence.scheduledLocalDate)).toEqual([
      '2026-12-28',
      '2026-12-30',
      '2027-01-11',
      '2027-01-13',
      '2027-01-25',
    ]);
  });

  it('bounds occurrence generation and rejects malformed dates', () => {
    expect(() =>
      generateHabitOccurrences(dailyHabit(), '2026-01-01', '2025-12-31'),
    ).toThrowError('Occurrence range is reversed');
    expect(() =>
      generateHabitOccurrences(dailyHabit(), '2025-01-01', '2026-01-02'),
    ).toThrowError('Occurrence range exceeds 366 days');
    expect(() =>
      generateHabitOccurrences(dailyHabit(), '2026-02-30', '2026-03-01'),
    ).toThrowError('Local date is invalid');
  });
});

describe('HabitService', () => {
  it('normalizes recurrence input and generates opaque entity identifiers', async () => {
    const service = new HabitService(new InMemoryHabitRepository());

    const habit = await service.createHabit('workspace-a', {
      title: '  Walk after lunch  ',
      timezone: 'Asia/Seoul',
      startsOn: '2026-08-04',
      recurrence: {
        kind: 'weekly',
        interval: 1,
        weekdays: [5, 1, 5],
      },
    });

    expect(habit.id).toMatch(UUID_V4_PATTERN);
    expect(habit.title).toBe('Walk after lunch');
    expect(habit.recurrence).toEqual({
      kind: 'weekly',
      interval: 1,
      weekdays: [1, 5],
    });
  });

  it('rejects invalid tenant, timezone, interval, weekday, and title input', async () => {
    const service = new HabitService(new InMemoryHabitRepository());

    await expect(
      service.createHabit('12345', {
        title: 'Habit',
        timezone: 'Asia/Seoul',
        startsOn: '2026-08-04',
        recurrence: { kind: 'daily', interval: 1 },
      }),
    ).rejects.toThrowError('Identifier must be an opaque non-numeric string');
    await expect(
      service.createHabit('workspace-a', {
        title: 'Habit',
        timezone: 'Not/A_Timezone',
        startsOn: '2026-08-04',
        recurrence: { kind: 'daily', interval: 1 },
      }),
    ).rejects.toThrowError('Timezone is invalid');
    await expect(
      service.createHabit('workspace-a', {
        title: 'Habit',
        timezone: 'UTC',
        startsOn: '2026-08-04',
        recurrence: { kind: 'daily', interval: 0 },
      }),
    ).rejects.toThrowError('Recurrence interval must be between 1 and 365');
    await expect(
      service.createHabit('workspace-a', {
        title: 'Habit',
        timezone: 'UTC',
        startsOn: '2026-08-04',
        recurrence: { kind: 'weekly', interval: 1, weekdays: [] },
      }),
    ).rejects.toThrowError('Weekly recurrence requires at least one weekday');
    await expect(
      service.createHabit('workspace-a', {
        title: 'Habit',
        timezone: 'UTC',
        startsOn: '2026-08-04',
        recurrence: {
          kind: 'weekly',
          interval: 1,
          weekdays: [8] as unknown as readonly IsoWeekday[],
        },
      }),
    ).rejects.toThrowError('Weekday must be between 1 and 7');
    await expect(
      service.createHabit('workspace-a', {
        title: '   ',
        timezone: 'UTC',
        startsOn: '2026-08-04',
        recurrence: { kind: 'weekly', interval: 1, weekdays: [1] },
      }),
    ).rejects.toThrowError('Title is required');
  });

  it('isolates habits and occurrence reads by workspace', async () => {
    const service = new HabitService(new InMemoryHabitRepository());
    const habit = await service.createHabit('workspace-a', {
      title: 'Private habit',
      timezone: 'UTC',
      startsOn: '2026-08-04',
      recurrence: { kind: 'daily', interval: 1 },
    });

    await expect(service.listHabits('workspace-b')).resolves.toEqual([]);
    await expect(
      service.listOccurrences(
        'workspace-b',
        habit.id,
        '2026-08-04',
        '2026-08-05',
      ),
    ).rejects.toThrowError('Habit not found');
  });

  it('keeps equal entity identifiers isolated across workspaces', async () => {
    const repository = new InMemoryHabitRepository();
    const sharedId = '22222222-2222-4222-8222-222222222222';
    const workspaceAHabit = dailyHabit({
      id: sharedId,
      workspaceId: 'workspace-a',
      title: 'Workspace A habit',
    });
    const workspaceBHabit = dailyHabit({
      id: sharedId,
      workspaceId: 'workspace-b',
      title: 'Workspace B habit',
    });

    await repository.saveHabit(workspaceAHabit);
    await repository.saveHabit(workspaceBHabit);

    await expect(repository.findHabit('workspace-a', sharedId)).resolves.toEqual(
      workspaceAHabit,
    );
    await expect(repository.findHabit('workspace-b', sharedId)).resolves.toEqual(
      workspaceBHabit,
    );
  });

  it('appends completion history idempotently and returns immutable copies', async () => {
    const repository = new InMemoryHabitRepository();
    const service = new HabitService(repository);
    const habit = await service.createHabit('workspace-a', {
      title: 'Complete safely',
      timezone: 'UTC',
      startsOn: '2026-08-04',
      recurrence: { kind: 'daily', interval: 1 },
    });
    const command = {
      scheduledLocalDate: '2026-08-04',
      completedAt: '2026-08-04T08:00:00.000Z',
      idempotencyKey: FIRST_IDEMPOTENCY_KEY,
    };

    const first = await service.completeHabit('workspace-a', habit.id, command);
    const replay = await service.completeHabit(
      'workspace-a',
      habit.id,
      command,
    );
    expect(replay).toEqual(first);
    expect(first.id).toMatch(UUID_V4_PATTERN);

    first.completedAt = '2030-01-01T00:00:00.000Z';
    const history = await service.listCompletionHistory(
      'workspace-a',
      habit.id,
    );
    expect(history).toHaveLength(1);
    expect(history[0]?.completedAt).toBe('2026-08-04T08:00:00.000Z');
  });

  it('rejects loose or malformed completion timestamps', async () => {
    const service = new HabitService(new InMemoryHabitRepository());
    const habit = await service.createHabit('workspace-a', {
      title: 'Strict completion time',
      timezone: 'UTC',
      startsOn: '2026-08-04',
      recurrence: { kind: 'daily', interval: 1 },
    });

    await expect(
      service.completeHabit('workspace-a', habit.id, {
        scheduledLocalDate: '2026-08-04',
        completedAt: 'August 4, 2026 08:00',
        idempotencyKey: FIRST_IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrowError('Timestamp is invalid');
  });

  it('rejects completion on a date without an occurrence', async () => {
    const service = new HabitService(new InMemoryHabitRepository());
    const habit = await service.createHabit('workspace-a', {
      title: 'Every other day',
      timezone: 'UTC',
      startsOn: '2026-08-04',
      recurrence: { kind: 'daily', interval: 2 },
    });

    await expect(
      service.completeHabit('workspace-a', habit.id, {
        scheduledLocalDate: '2026-08-05',
        completedAt: '2026-08-05T08:00:00.000Z',
        idempotencyKey: FIRST_IDEMPOTENCY_KEY,
      }),
    ).rejects.toThrowError('Habit is not scheduled on this date');
  });
});
