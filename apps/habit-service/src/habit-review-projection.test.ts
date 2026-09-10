import { describe, expect, it } from 'vitest';
import { HabitService, InMemoryHabitRepository } from './habit-domain';

const WORKSPACE_ID = 'workspace-review';
const OTHER_WORKSPACE_ID = 'workspace-other';
const AS_OF = '2026-09-13T23:59:59.000Z';

/**
 * Seeds durable Habit evidence without deriving any Review metric in the test.
 * The production projection remains responsible for recurrence denominators.
 */
async function createService(): Promise<HabitService> {
  const service = new HabitService(
    new InMemoryHabitRepository(),
    () => AS_OF,
  );
  const daily = await service.createHabit(WORKSPACE_ID, {
    title: 'Read deliberately',
    timezone: 'Asia/Seoul',
    startsOn: '2026-09-07',
    recurrence: { kind: 'daily', interval: 1 },
  });
  const twiceWeekly = await service.createHabit(WORKSPACE_ID, {
    title: 'Strength practice',
    timezone: 'America/New_York',
    startsOn: '2026-09-07',
    recurrence: { kind: 'weekly', interval: 1, weekdays: [2, 4] },
  });
  const foreign = await service.createHabit(OTHER_WORKSPACE_ID, {
    title: 'Other tenant habit',
    timezone: 'UTC',
    startsOn: '2026-09-07',
    recurrence: { kind: 'daily', interval: 1 },
  });

  await service.completeHabit(WORKSPACE_ID, daily.id, {
    scheduledLocalDate: '2026-09-07',
    completedAt: '2026-09-07T08:00:00.000Z',
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
  });
  await service.completeHabit(WORKSPACE_ID, daily.id, {
    scheduledLocalDate: '2026-09-09',
    completedAt: '2026-09-09T08:00:00.000Z',
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
  });
  await service.completeHabit(WORKSPACE_ID, twiceWeekly.id, {
    scheduledLocalDate: '2026-09-10',
    completedAt: '2026-09-10T12:00:00.000Z',
    idempotencyKey: '33333333-3333-4333-8333-333333333333',
  });
  await service.completeHabit(OTHER_WORKSPACE_ID, foreign.id, {
    scheduledLocalDate: '2026-09-07',
    completedAt: '2026-09-07T01:00:00.000Z',
    idempotencyKey: '44444444-4444-4444-8444-444444444444',
  });
  return service;
}

class DuplicateHabitEvidenceRepository extends InMemoryHabitRepository {
  async readReviewWeekEvidence(
    workspaceId: string,
    periodStartDate: string,
    periodEndDate: string,
    maximumHabits: number,
  ) {
    const evidence = await super.readReviewWeekEvidence(
      workspaceId,
      periodStartDate,
      periodEndDate,
      maximumHabits,
    );
    const [habit] = evidence.habits;
    if (!habit) throw new Error('Expected seeded habit');
    return {
      habits: [...evidence.habits, habit],
      completions: evidence.completions,
    };
  }
}

describe('Habit weekly Review projection', () => {
  it('preserves the scheduled-opportunity denominator and tenant boundary', async () => {
    const service = await createService();

    const projection = await service.projectReviewWeek(
      WORKSPACE_ID,
      '2026-09-07',
    );

    expect(projection).toEqual({
      schemaVersion: 'life-os.habit-review-projection.v1',
      periodStartDate: '2026-09-07',
      periodEndDate: '2026-09-13',
      periodBasis: 'habit-local-date',
      asOf: AS_OF,
      scheduledOpportunityCount: 9,
      completedOpportunityCount: 3,
      habits: [
        {
          habitId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          title: 'Read deliberately',
          timezone: 'Asia/Seoul',
          scheduledOpportunityCount: 7,
          completedOpportunityCount: 2,
        },
        {
          habitId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
          title: 'Strength practice',
          timezone: 'America/New_York',
          scheduledOpportunityCount: 2,
          completedOpportunityCount: 1,
        },
      ],
    });
  });

  it('counts a scheduled opportunity at most once despite duplicate completion events', async () => {
    const service = await createService();
    const [daily] = await service.listHabits(WORKSPACE_ID);
    if (!daily) throw new Error('Expected seeded habit');

    await service.completeHabit(WORKSPACE_ID, daily.id, {
      scheduledLocalDate: '2026-09-07',
      completedAt: '2026-09-07T09:00:00.000Z',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    });

    const projection = await service.projectReviewWeek(
      WORKSPACE_ID,
      '2026-09-07',
    );
    expect(projection.completedOpportunityCount).toBe(3);
    expect(projection.habits[0]?.completedOpportunityCount).toBe(2);
  });

  it('rejects duplicate habit identities from persistence evidence', async () => {
    const repository = new DuplicateHabitEvidenceRepository();
    const service = new HabitService(repository, () => AS_OF);
    await service.createHabit(WORKSPACE_ID, {
      title: 'Read deliberately',
      timezone: 'Asia/Seoul',
      startsOn: '2026-09-07',
      recurrence: { kind: 'daily', interval: 1 },
    });

    await expect(
      service.projectReviewWeek(WORKSPACE_ID, '2026-09-07'),
    ).rejects.toThrowError('Review projection habit evidence is invalid');
  });

  it('requires a real Monday review period and rejects unbounded habit collections', async () => {
    const service = await createService();
    await expect(
      service.projectReviewWeek(WORKSPACE_ID, '2026-09-08'),
    ).rejects.toThrowError('Review period must start on Monday');

    const repository = new InMemoryHabitRepository();
    const bounded = new HabitService(repository, () => AS_OF);
    for (let index = 0; index < 101; index += 1) {
      await bounded.createHabit(WORKSPACE_ID, {
        title: `Habit ${index}`,
        timezone: 'UTC',
        startsOn: '2026-09-07',
        recurrence: { kind: 'daily', interval: 1 },
      });
    }
    await expect(
      bounded.projectReviewWeek(WORKSPACE_ID, '2026-09-07'),
    ).rejects.toThrowError('Review projection exceeds habit limit');
  });
});
