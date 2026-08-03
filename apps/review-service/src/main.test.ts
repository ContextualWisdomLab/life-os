import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ReviewController } from './main';
import {
  ReviewService,
  type ReviewCompletionRecord,
  type ReviewRepository,
} from './review-domain';

const WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const IDEMPOTENCY_KEY = 'd1191b96-b7f4-4d8f-b1f7-9e2838686d5f';
const COMPLETION_ID = '3f044b68-c515-4a52-8862-38af0047b88d';

class InMemoryReviewRepository implements ReviewRepository {
  readonly records: ReviewCompletionRecord[] = [];

  async record(
    completion: ReviewCompletionRecord,
  ): Promise<ReviewCompletionRecord> {
    this.records.push(completion);
    return completion;
  }

  async list(): Promise<ReviewCompletionRecord[]> {
    return [...this.records];
  }
}

function body() {
  return {
    periodStartDate: '2026-08-03',
    idempotencyKey: IDEMPOTENCY_KEY,
    completedStepCount: 5,
    totalStepCount: 5,
    plannedItemCount: 4,
    completedItemCount: 3,
    habitCompletionCount: 2,
    completedAt: '2026-08-03T20:00:00.000Z',
  };
}

describe('Review controller', () => {
  it('exposes health and all three guided completion routes', async () => {
    const repository = new InMemoryReviewRepository();
    const service = new ReviewService(
      repository,
      () => COMPLETION_ID,
      () => '2026-08-03T20:00:01.000Z',
    );
    const controller = new ReviewController(service);

    expect(controller.health()).toEqual({
      status: 'ok',
      service: 'review-service',
    });
    await expect(
      controller.completeDailyPlanning(WORKSPACE_ID, body()),
    ).resolves.toMatchObject({ ritualKind: 'daily-planning' });
    await expect(
      controller.completeDailyShutdown(WORKSPACE_ID, body()),
    ).resolves.toMatchObject({ ritualKind: 'daily-shutdown' });
    await expect(
      controller.completeWeeklyReview(WORKSPACE_ID, body()),
    ).resolves.toMatchObject({ ritualKind: 'weekly-review' });
    await expect(
      controller.listCompletions(WORKSPACE_ID, '10'),
    ).resolves.toHaveLength(3);
  });

  it('fails closed before the domain for invalid workspace ownership', async () => {
    const controller = new ReviewController(
      new ReviewService(new InMemoryReviewRepository()),
    );
    await expect(
      controller.completeDailyPlanning('invalid', body()),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
