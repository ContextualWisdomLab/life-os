import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as reviewHistoryGET } from './completions/route';
import { POST as weeklyReviewPOST } from './weekly-review/completions/route';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';
const CONTEXT_SECRET = 'review-gateway-context-secret-32-bytes';

function reviewRecord(): Record<string, unknown> {
  return {
    id: REVIEW_ID,
    workspaceId: WORKSPACE_ID,
    ritualKind: 'weekly-review',
    periodStartDate: '2026-08-31',
    idempotencyKey: IDEMPOTENCY_KEY,
    completedStepCount: 4,
    totalStepCount: 4,
    plannedItemCount: 7,
    completedItemCount: 5,
    habitCompletionCount: 3,
    reflection: 'Keep the next week smaller.',
    completedAt: '2026-09-01T09:00:00.000Z',
    payloadDigest: 'a'.repeat(64),
    recordedAt: '2026-09-01T09:00:01.000Z',
  };
}

describe('Review Next.js route handlers', () => {
  it('delegates authenticated history and Weekly Review completion through the BFF', async () => {
    const originalFetch = globalThis.fetch;
    const originalIdentityOrigin = process.env.IDENTITY_SERVICE_ORIGIN;
    const originalReviewOrigin = process.env.REVIEW_SERVICE_ORIGIN;
    const originalContextSecret = process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
    const reviewCalls: Array<{ method: string; path: string }> = [];
    process.env.IDENTITY_SERVICE_ORIGIN = 'http://identity-service:4101';
    process.env.REVIEW_SERVICE_ORIGIN = 'http://review-service:4104';
    process.env.REVIEW_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;

    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/session') {
        return Response.json({
          sessionId: SESSION_ID,
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          createdAt: '2026-09-01T01:00:00.000Z',
          expiresAt: '2026-09-02T01:00:00.000Z',
        });
      }
      const method = init?.method ?? 'GET';
      reviewCalls.push({ method, path: url.pathname });
      return method === 'POST'
        ? Response.json(reviewRecord(), { status: 201 })
        : Response.json([reviewRecord()]);
    };

    try {
      assert.equal(
        (
          await reviewHistoryGET(
            new Request('https://life-os.example/api/reviews/completions?limit=20', {
              headers: { cookie: 'life_os_session=opaque' },
            }),
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await weeklyReviewPOST(
            new Request(
              'https://life-os.example/api/reviews/weekly-review/completions',
              {
                method: 'POST',
                headers: {
                  cookie: 'life_os_session=opaque',
                  'content-type': 'application/json',
                },
                body: JSON.stringify({
                  periodStartDate: '2026-08-31',
                  idempotencyKey: IDEMPOTENCY_KEY,
                  completedStepCount: 4,
                  totalStepCount: 4,
                  plannedItemCount: 7,
                  completedItemCount: 5,
                  habitCompletionCount: 3,
                  reflection: 'Keep the next week smaller.',
                  completedAt: '2026-09-01T09:00:00.000Z',
                }),
              },
            ),
          )
        ).status,
        201,
      );
      assert.deepEqual(reviewCalls, [
        { method: 'GET', path: '/v1/reviews/completions' },
        { method: 'POST', path: '/v1/reviews/weekly-review/completions' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalIdentityOrigin === undefined) delete process.env.IDENTITY_SERVICE_ORIGIN;
      else process.env.IDENTITY_SERVICE_ORIGIN = originalIdentityOrigin;
      if (originalReviewOrigin === undefined) delete process.env.REVIEW_SERVICE_ORIGIN;
      else process.env.REVIEW_SERVICE_ORIGIN = originalReviewOrigin;
      if (originalContextSecret === undefined) delete process.env.REVIEW_GATEWAY_CONTEXT_SECRET;
      else process.env.REVIEW_GATEWAY_CONTEXT_SECRET = originalContextSecret;
    }
  });
});
