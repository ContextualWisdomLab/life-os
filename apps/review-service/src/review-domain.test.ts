import { describe, expect, it, vi } from 'vitest';
import {
  parseReviewCompletionInput,
  requireReviewLimit,
  ReviewService,
  ReviewValidationError,
  type ReviewCompletionRecord,
  type ReviewRepository,
} from './review-domain';

const WORKSPACE_ID = '018f47b2-c1d2-4a30-8c17-221fb579c042';
const IDEMPOTENCY_KEY = 'd1191b96-b7f4-4d8f-b1f7-9e2838686d5f';
const COMPLETION_ID = '3f044b68-c515-4a52-8862-38af0047b88d';
const COMPLETED_AT = '2026-08-03T20:00:00.000Z';
const RECORDED_AT = '2026-08-03T20:00:01.000Z';

function completionBody(overrides: Record<string, unknown> = {}) {
  return {
    periodStartDate: '2026-08-03',
    idempotencyKey: IDEMPOTENCY_KEY,
    completedStepCount: 5,
    totalStepCount: 5,
    plannedItemCount: 4,
    completedItemCount: 3,
    habitCompletionCount: 2,
    reflection: '  Kept commitments bounded.  ',
    completedAt: COMPLETED_AT,
    ...overrides,
  };
}

class RecordingRepository implements ReviewRepository {
  readonly record = vi.fn(
    async (value: ReviewCompletionRecord): Promise<ReviewCompletionRecord> =>
      value,
  );
  readonly list = vi.fn(async (): Promise<ReviewCompletionRecord[]> => []);
}

describe('guided review domain', () => {
  it('parses bounded weekly evidence and computes a deterministic digest', () => {
    const first = parseReviewCompletionInput(
      WORKSPACE_ID,
      'weekly-review',
      completionBody(),
    );
    const second = parseReviewCompletionInput(
      WORKSPACE_ID,
      'weekly-review',
      completionBody(),
    );

    expect(first.reflection).toBe('Kept commitments bounded.');
    expect(first.payloadDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.payloadDigest).toBe(second.payloadDigest);
  });

  it.each([
    [{ ...completionBody(), workspaceId: WORKSPACE_ID }],
    [completionBody({ completedStepCount: 4 })],
    [completionBody({ completedItemCount: 5 })],
    [completionBody({ periodStartDate: '2026-08-04' })],
    [completionBody({ reflection: 'x'.repeat(2001) })],
  ])('rejects malformed or ownership-bearing completion input', (body) => {
    expect(() =>
      parseReviewCompletionInput(WORKSPACE_ID, 'weekly-review', body),
    ).toThrow(ReviewValidationError);
  });

  it('creates immutable records with injected identifiers and timestamps', async () => {
    const repository = new RecordingRepository();
    const service = new ReviewService(
      repository,
      () => COMPLETION_ID,
      () => RECORDED_AT,
    );

    const result = await service.complete(
      WORKSPACE_ID,
      'daily-planning',
      completionBody(),
    );

    expect(result).toMatchObject({
      id: COMPLETION_ID,
      workspaceId: WORKSPACE_ID,
      ritualKind: 'daily-planning',
      idempotencyKey: IDEMPOTENCY_KEY,
      recordedAt: RECORDED_AT,
    });
    expect(repository.record).toHaveBeenCalledOnce();
  });

  it('validates bounded history limits before repository access', async () => {
    const repository = new RecordingRepository();
    const service = new ReviewService(repository);

    await expect(service.list(WORKSPACE_ID, 101)).rejects.toThrow(
      ReviewValidationError,
    );
    expect(repository.list).not.toHaveBeenCalled();
    expect(requireReviewLimit(undefined)).toBe(50);
    expect(requireReviewLimit('100')).toBe(100);
    expect(() => requireReviewLimit('0')).toThrow(ReviewValidationError);
  });
});
