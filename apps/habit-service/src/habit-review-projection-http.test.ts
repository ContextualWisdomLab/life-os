import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HabitReviewWeekProjection, HabitService } from './habit-domain';
import {
  HABIT_REVIEW_PROJECTION_PATH,
  requireReviewPeriodStartDate,
  requireTrustedReviewProjectionContext,
} from './habit-request-bound-context';
import { HabitController } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PERIOD_START_DATE = '2026-09-07';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');

function signature(
  issuedAt: string,
  method = 'GET',
  path = HABIT_REVIEW_PROJECTION_PATH,
): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.habit-context.v2\n${WORKSPACE_ID}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

function legacySignature(issuedAt: string): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(`life-os.workspace.v1\n${WORKSPACE_ID}\n${issuedAt}`, 'utf8')
    .digest('base64url');
}

function projection(): HabitReviewWeekProjection {
  return {
    schemaVersion: 'life-os.habit-review-projection.v1',
    periodStartDate: PERIOD_START_DATE,
    periodEndDate: '2026-09-13',
    periodBasis: 'habit-local-date',
    asOf: '2026-09-10T12:00:00.000Z',
    scheduledOpportunityCount: 1,
    completedOpportunityCount: 1,
    habits: [
      {
        habitId: '22222222-2222-4222-8222-222222222222',
        title: 'Morning walk',
        timezone: 'Asia/Seoul',
        scheduledOpportunityCount: 1,
        completedOpportunityCount: 1,
      },
    ],
  };
}

afterEach(() => {
  delete process.env.HABIT_GATEWAY_CONTEXT_SECRET;
  vi.restoreAllMocks();
});

describe('Habit Weekly Review HTTP authority', () => {
  it('accepts only a short-lived context bound to the exact Review GET path', () => {
    const nowSeconds = 1_789_000_000;
    const issuedAt = String(nowSeconds);

    expect(
      requireTrustedReviewProjectionContext(
        {
          workspaceId: WORKSPACE_ID,
          issuedAt,
          signature: signature(issuedAt),
        },
        CONTEXT_SECRET,
        { method: 'GET', path: HABIT_REVIEW_PROJECTION_PATH },
        nowSeconds,
      ),
    ).toBe(WORKSPACE_ID);

    for (const candidate of [
      {
        signature: legacySignature(issuedAt),
        method: 'GET',
        path: HABIT_REVIEW_PROJECTION_PATH,
      },
      {
        signature: signature(issuedAt),
        method: 'POST',
        path: HABIT_REVIEW_PROJECTION_PATH,
      },
      {
        signature: signature(issuedAt),
        method: 'GET',
        path: '/v1/habits/today',
      },
    ]) {
      expect(() =>
        requireTrustedReviewProjectionContext(
          {
            workspaceId: WORKSPACE_ID,
            issuedAt,
            signature: candidate.signature,
          },
          CONTEXT_SECRET,
          { method: candidate.method, path: candidate.path },
          nowSeconds,
        ),
      ).toThrow(HttpException);
    }
  });

  it('requires an exact Monday review period before domain access', () => {
    expect(requireReviewPeriodStartDate(PERIOD_START_DATE)).toBe(
      PERIOD_START_DATE,
    );
    for (const invalid of [undefined, '', '2026-02-30', '2026-09-08']) {
      expect(() => requireReviewPeriodStartDate(invalid)).toThrow(HttpException);
    }
  });

  it('delegates the fixed Review route only after request-bound workspace verification', async () => {
    process.env.HABIT_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const projectReviewWeek = vi.fn().mockResolvedValue(projection());
    const controller = new HabitController({
      projectReviewWeek,
    } as unknown as HabitService);

    await expect(
      controller.projectReviewWeek(
        WORKSPACE_ID,
        issuedAt,
        signature(issuedAt),
        PERIOD_START_DATE,
      ),
    ).resolves.toEqual(projection());
    expect(projectReviewWeek).toHaveBeenCalledTimes(1);
    expect(projectReviewWeek).toHaveBeenCalledWith(
      WORKSPACE_ID,
      PERIOD_START_DATE,
    );
  });

  it('rejects a legacy workspace-only signature before the projection domain call', async () => {
    process.env.HABIT_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const projectReviewWeek = vi.fn();
    const controller = new HabitController({
      projectReviewWeek,
    } as unknown as HabitService);

    await expect(
      controller.projectReviewWeek(
        WORKSPACE_ID,
        issuedAt,
        legacySignature(issuedAt),
        PERIOD_START_DATE,
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(projectReviewWeek).not.toHaveBeenCalled();
  });
});
