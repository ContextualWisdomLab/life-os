import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { handleReviewHistoryRequest, type ReviewFetch } from './review-client';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REVIEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const IDEMPOTENCY_KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NOW_SECONDS = 1_788_220_800;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  REVIEW_SERVICE_ORIGIN: 'http://review-service:4104',
  REVIEW_GATEWAY_CONTEXT_SECRET: 'review-gateway-context-secret-32-bytes',
};

function historyRequest(): Request {
  return new Request(
    'https://life-os.example/api/reviews/completions?limit=20',
    {
      method: 'GET',
      headers: { cookie: 'life_os_session=opaque_session_value' },
    },
  );
}

function reviewRecord(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
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
    ...overrides,
  };
}

async function runHistory(fetcher: ReviewFetch): Promise<Response> {
  return handleReviewHistoryRequest(
    historyRequest(),
    environment,
    fetcher,
    NOW_SECONDS,
  );
}

describe('Review BFF canonical durable identity evidence', () => {
  it('rejects noncanonical Identity workspace authority before Review access', async () => {
    let calls = 0;
    const response = await runHistory(async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ workspaceId: WORKSPACE_ID.toUpperCase() })
        : Response.json([]);
    });

    assert.equal(response.status, 503);
    assert.equal(calls, 1);
  });

  it('rejects noncanonical Review record identity instead of recanonicalizing it', async () => {
    let calls = 0;
    const response = await runHistory(async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ workspaceId: WORKSPACE_ID })
        : Response.json([reviewRecord({ id: REVIEW_ID.toUpperCase() })]);
    });

    assert.equal(response.status, 503);
    assert.equal(calls, 2);
  });

  it('rejects noncanonical Review workspace evidence instead of aliasing authority', async () => {
    let calls = 0;
    const response = await runHistory(async () => {
      calls += 1;
      return calls === 1
        ? Response.json({ workspaceId: WORKSPACE_ID })
        : Response.json([
            reviewRecord({ workspaceId: WORKSPACE_ID.toUpperCase() }),
          ]);
    });

    assert.equal(response.status, 503);
    assert.equal(calls, 2);
  });
});
