import { describe, expect, it } from 'vitest';
import { InMemoryHabitRepository } from './habit-domain';

const WORKSPACE_ID = 'workspace-review-contract';
const AS_OF = '2026-09-13T23:59:59.000Z';

describe('Habit Review evidence repository contract', () => {
  it('accepts one Monday-through-Sunday period within the supported habit bound', async () => {
    const repository = new InMemoryHabitRepository();

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-07',
        '2026-09-13',
        100,
        AS_OF,
      ),
    ).resolves.toEqual({ habits: [], completions: [] });
  });

  it('rejects a period longer than one Review week', async () => {
    const repository = new InMemoryHabitRepository();

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-07',
        '2026-09-14',
        100,
        AS_OF,
      ),
    ).rejects.toThrowError('Review evidence request is invalid');
  });

  it('rejects a seven-day period that does not start Monday', async () => {
    const repository = new InMemoryHabitRepository();

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-08',
        '2026-09-14',
        100,
        AS_OF,
      ),
    ).rejects.toThrowError('Review evidence request is invalid');
  });

  it('rejects a habit ceiling outside the shared 1..100 contract', async () => {
    const repository = new InMemoryHabitRepository();

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-07',
        '2026-09-13',
        0,
        AS_OF,
      ),
    ).rejects.toThrowError('Review evidence request is invalid');
  });

  it('does not attribute completion evidence recorded after the advertised asOf instant', async () => {
    const repository = new InMemoryHabitRepository();
    await repository.saveHabit({
      id: 'habit-review-as-of',
      workspaceId: WORKSPACE_ID,
      title: 'Read deliberately',
      timezone: 'UTC',
      startsOn: '2026-09-07',
      recurrence: { kind: 'daily', interval: 1 },
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    await repository.appendCompletion({
      id: 'completion-recorded-after-as-of',
      workspaceId: WORKSPACE_ID,
      habitId: 'habit-review-as-of',
      scheduledLocalDate: '2026-09-07',
      completedAt: '2026-09-07T08:00:00.000Z',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      recordedAt: '2026-09-14T00:00:00.000Z',
    });

    const evidence = await repository.readReviewWeekEvidence(
      WORKSPACE_ID,
      '2026-09-07',
      '2026-09-13',
      100,
      AS_OF,
    );

    expect(evidence.completions).toEqual([]);
  });
});
