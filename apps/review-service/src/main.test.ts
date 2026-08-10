import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  requireReviewServiceConfiguration,
  ReviewController,
} from './main';
import {
  ReviewService,
  type ReviewCompletionRecord,
  type ReviewRepository,
} from './review-domain';

const WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const IDEMPOTENCY_KEY = 'd1191b96-b7f4-4d8f-b1f7-9e2838686d5f';
const COMPLETION_ID = '3f044b68-c515-4a52-8862-38af0047b88d';
const GATEWAY_SECRET = randomBytes(32).toString('base64url');
let previousGatewaySecret: string | undefined;

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

function trustedContext(workspaceId = WORKSPACE_ID): readonly [string, string] {
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const normalizedWorkspaceId = workspaceId.toLowerCase();
  const signature = createHmac('sha256', GATEWAY_SECRET)
    .update(
      `life-os.workspace.v1\n${normalizedWorkspaceId}\n${issuedAt}`,
      'utf8',
    )
    .digest('base64url');
  return [issuedAt, signature] as const;
}

describe('Review controller', () => {
  beforeEach(() => {
    previousGatewaySecret = process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
    process.env.REVIEW_GATEWAY_CONTEXT_SECRET = GATEWAY_SECRET;
  });

  afterEach(() => {
    if (previousGatewaySecret === undefined) {
      delete process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
    } else {
      process.env.REVIEW_GATEWAY_CONTEXT_SECRET = previousGatewaySecret;
    }
  });

  it('exposes health and all three guided completion routes', async () => {
    const repository = new InMemoryReviewRepository();
    const service = new ReviewService(
      repository,
      () => COMPLETION_ID,
      () => '2026-08-03T20:00:01.000Z',
    );
    const controller = new ReviewController(service);
    const [issuedAt, signature] = trustedContext();

    expect(controller.health()).toEqual({
      status: 'ok',
      service: 'review-service',
    });
    await expect(
      controller.completeDailyPlanning(
        WORKSPACE_ID,
        issuedAt,
        signature,
        body(),
      ),
    ).resolves.toMatchObject({ ritualKind: 'daily-planning' });
    await expect(
      controller.completeDailyShutdown(
        WORKSPACE_ID,
        issuedAt,
        signature,
        body(),
      ),
    ).resolves.toMatchObject({ ritualKind: 'daily-shutdown' });
    await expect(
      controller.completeWeeklyReview(
        WORKSPACE_ID,
        issuedAt,
        signature,
        body(),
      ),
    ).resolves.toMatchObject({ ritualKind: 'weekly-review' });
    await expect(
      controller.listCompletions(WORKSPACE_ID, issuedAt, signature, '10'),
    ).resolves.toHaveLength(3);
  });

  it('keeps startup and readiness fail-closed for unsafe gateway secrets', () => {
    const controller = new ReviewController(
      new ReviewService(new InMemoryReviewRepository()),
    );

    delete process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
    expect(() => requireReviewServiceConfiguration(process.env)).toThrow(
      HttpException,
    );
    expect(() => controller.ready()).toThrow(HttpException);

    process.env.REVIEW_GATEWAY_CONTEXT_SECRET = 'too-short';
    expect(() => requireReviewServiceConfiguration(process.env)).toThrow(
      HttpException,
    );
    expect(() => controller.ready()).toThrow(HttpException);

    process.env.REVIEW_GATEWAY_CONTEXT_SECRET = GATEWAY_SECRET;
    expect(() => requireReviewServiceConfiguration(process.env)).not.toThrow();
    expect(controller.ready()).toEqual({
      status: 'ready',
      service: 'review-service',
    });
  });

  it('fails closed before the domain for invalid workspace ownership', async () => {
    const controller = new ReviewController(
      new ReviewService(new InMemoryReviewRepository()),
    );
    const [issuedAt, signature] = trustedContext('invalid');
    await expect(
      controller.completeDailyPlanning('invalid', issuedAt, signature, body()),
    ).rejects.toBeInstanceOf(HttpException);
  });
});
