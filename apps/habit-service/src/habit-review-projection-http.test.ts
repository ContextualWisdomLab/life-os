import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const CONTROLLER_SOURCE = readFileSync(join(__dirname, 'main.ts'), 'utf8');

interface ReviewHttpRequest {
  readonly method?: string;
  readonly originalUrl?: string;
  readonly url?: string;
}

type RequestBoundProjectionRoute = (
  request: ReviewHttpRequest,
  workspaceId: string | undefined,
  issuedAt: string | undefined,
  signature: string | undefined,
  periodStartDate: string | undefined,
) => Promise<HabitReviewWeekProjection>;

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
    producer: 'habit',
    projectionRevision:
      'sha256:0000000000000000000000000000000000000000000000000000000000000000',
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

function invokeRequestBoundProjection(
  controller: HabitController,
  request: ReviewHttpRequest,
  issuedAt: string,
  requestSignature: string,
): Promise<HabitReviewWeekProjection> {
  const route = controller.projectReviewWeek.bind(
    controller,
  ) as unknown as RequestBoundProjectionRoute;
  return route(
    request,
    WORKSPACE_ID,
    issuedAt,
    requestSignature,
    PERIOD_START_DATE,
  );
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
      expect(() => requireReviewPeriodStartDate(invalid)).toThrow(
        HttpException,
      );
    }
  });

  it('receives the Nest request object before verifying Review authority', () => {
    expect(CONTROLLER_SOURCE).toContain(
      '@Req() request: HabitReviewProjectionHttpRequest',
    );
    expect(CONTROLLER_SOURCE).toContain(
      'requireExactReviewProjectionHttpBinding(request)',
    );
    expect(CONTROLLER_SOURCE).not.toContain(
      "{ method: 'GET', path: HABIT_REVIEW_PROJECTION_PATH }",
    );
  });

  it('delegates only when the observed request is the canonical Review GET route', async () => {
    process.env.HABIT_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const projectReviewWeek = vi.fn().mockResolvedValue(projection());
    const controller = new HabitController({
      projectReviewWeek,
    } as unknown as HabitService);

    await expect(
      invokeRequestBoundProjection(
        controller,
        {
          method: 'GET',
          originalUrl: `${HABIT_REVIEW_PROJECTION_PATH}?periodStartDate=${PERIOD_START_DATE}`,
        },
        issuedAt,
        signature(issuedAt),
      ),
    ).resolves.toEqual(projection());
    expect(projectReviewWeek).toHaveBeenCalledTimes(1);
    expect(projectReviewWeek).toHaveBeenCalledWith(
      WORKSPACE_ID,
      PERIOD_START_DATE,
    );
  });

  it('rejects transport aliases and wrong methods before the projection domain call', async () => {
    process.env.HABIT_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));

    for (const request of [
      {
        method: 'GET',
        originalUrl: `${HABIT_REVIEW_PROJECTION_PATH}/?periodStartDate=${PERIOD_START_DATE}`,
      },
      {
        method: 'GET',
        originalUrl: `/v1//habits/review-projection?periodStartDate=${PERIOD_START_DATE}`,
      },
      {
        method: 'GET',
        originalUrl: `/v1/habits/review-projection%2F?periodStartDate=${PERIOD_START_DATE}`,
      },
      {
        method: 'POST',
        originalUrl: `${HABIT_REVIEW_PROJECTION_PATH}?periodStartDate=${PERIOD_START_DATE}`,
      },
    ]) {
      const projectReviewWeek = vi.fn();
      const controller = new HabitController({
        projectReviewWeek,
      } as unknown as HabitService);

      await expect(
        invokeRequestBoundProjection(
          controller,
          request,
          issuedAt,
          signature(issuedAt),
        ),
      ).rejects.toBeInstanceOf(HttpException);
      expect(projectReviewWeek).not.toHaveBeenCalled();
    }
  });

  it('rejects a legacy workspace-only signature before the projection domain call', async () => {
    process.env.HABIT_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const projectReviewWeek = vi.fn();
    const controller = new HabitController({
      projectReviewWeek,
    } as unknown as HabitService);

    await expect(
      invokeRequestBoundProjection(
        controller,
        {
          method: 'GET',
          originalUrl: `${HABIT_REVIEW_PROJECTION_PATH}?periodStartDate=${PERIOD_START_DATE}`,
        },
        issuedAt,
        legacySignature(issuedAt),
      ),
    ).rejects.toBeInstanceOf(HttpException);
    expect(projectReviewWeek).not.toHaveBeenCalled();
  });
});
