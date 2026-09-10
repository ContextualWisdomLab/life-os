import { describe, expect, it } from 'vitest';
import { InMemoryHabitRepository } from './habit-domain';

const WORKSPACE_ID = 'workspace-review-contract';

describe('Habit Review evidence repository contract', () => {
  it('accepts one Monday-through-Sunday period within the supported habit bound', async () => {
    const repository = new InMemoryHabitRepository();

    await expect(
      repository.readReviewWeekEvidence(
        WORKSPACE_ID,
        '2026-09-07',
        '2026-09-13',
        100,
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
      ),
    ).rejects.toThrowError('Review evidence request is invalid');
  });
});
