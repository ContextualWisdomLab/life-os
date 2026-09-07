import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  handleReviewHistoryRequest,
  handleWeeklyReviewCompletionRequest,
  type ReviewFetch,
} from './review-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REVIEW_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_REVIEW_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';
const CONTEXT_SECRET = 'review-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_788_220_800;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  REVIEW_SERVICE_ORIGIN: 'http://review-service:4104',
  REVIEW_GATEWAY_CONTEXT_SECRET: CONTEXT_SECRET,
};

function sessionResponse(status = 200): Response {
  return Response.json(
    {
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      createdAt: '2026-09-01T01:00:00.000Z',
      expiresAt: '2026-09-02T01:00:00.000Z',
    },
    { status },
  );
}

function completionRecord(
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

function completionRequest(body: unknown): Request {
  return new Request(
    'https://life-os.example/api/reviews/weekly-review/completions',
    {
      method: 'POST',
      headers: {
        cookie: 'life_os_session=opaque_session_value',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
}

function historyRequest(limit = '20'): Request {
  return new Request(
    `https://life-os.example/api/reviews/completions?limit=${limit}`,
    {
      method: 'GET',
      headers: { cookie: 'life_os_session=opaque_session_value' },
    },
  );
}

const validCompletion = {
  periodStartDate: '2026-08-31',
  idempotencyKey: IDEMPOTENCY_KEY,
  completedStepCount: 4,
  totalStepCount: 4,
  plannedItemCount: 7,
  completedItemCount: 5,
  habitCompletionCount: 3,
  reflection: 'Keep the next week smaller.',
  completedAt: '2026-09-01T09:00:00.000Z',
};

describe('authenticated Weekly Review completion BFF', () => {
  it('derives workspace authority from Identity and signs the exact Review route', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: ReviewFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1
        ? sessionResponse()
        : Response.json(completionRecord(), { status: 201 });
    };

    const response = await handleWeeklyReviewCompletionRequest(
      completionRequest(validCompletion),
      environment,
      fetcher,
      NOW_SECONDS,
    );

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      id: REVIEW_ID,
      ritualKind: 'weekly-review',
      periodStartDate: '2026-08-31',
      completedStepCount: 4,
      totalStepCount: 4,
      plannedItemCount: 7,
      completedItemCount: 5,
      habitCompletionCount: 3,
      reflection: 'Keep the next week smaller.',
      completedAt: '2026-09-01T09:00:00.000Z',
      recordedAt: '2026-09-01T09:00:01.000Z',
    });

    assert.equal(calls[0]?.url, 'http://identity-service:4101/v1/session');
    assert.equal(
      new Headers(calls[0]?.init?.headers).get('cookie'),
      'life_os_session=opaque_session_value',
    );
    assert.equal(
      calls[1]?.url,
      'http://review-service:4104/v1/reviews/weekly-review/completions',
    );
    assert.equal(calls[1]?.init?.method, 'POST');
    assert.equal(calls[1]?.init?.body, JSON.stringify(validCompletion));
    const headers = new Headers(calls[1]?.init?.headers);
    assert.equal(headers.get('cookie'), null);
    assert.equal(headers.get('x-life-os-workspace-id'), WORKSPACE_ID);
    assert.equal(headers.get('x-life-os-context-issued-at'), String(NOW_SECONDS));
    assert.equal(
      headers.get('x-life-os-context-signature'),
      createHmac('sha256', CONTEXT_SECRET)
        .update(
          `life-os.review-context.v1\n${WORKSPACE_ID}\n${NOW_SECONDS}\nPOST\n/v1/reviews/weekly-review/completions`,
          'utf8',
        )
        .digest('base64url'),
    );
  });

  it('rejects malformed or authority-bearing completion bodies before dependency access', async () => {
    const invalidBodies = [
      null,
      {},
      { ...validCompletion, workspaceId: WORKSPACE_ID },
      { ...validCompletion, payloadDigest: 'a'.repeat(64) },
      { ...validCompletion, periodStartDate: '2026-09-01' },
      { ...validCompletion, completedStepCount: 3 },
      { ...validCompletion, completedItemCount: 8 },
      { ...validCompletion, reflection: ' x' },
    ];

    for (const body of invalidBodies) {
      let called = false;
      const response = await handleWeeklyReviewCompletionRequest(
        completionRequest(body),
        environment,
        async () => {
          called = true;
          return sessionResponse();
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 400);
      assert.equal(called, false);
    }
  });

  it('maps unauthenticated identity and immutable completion conflicts without forwarding upstream bodies', async () => {
    const unauthenticated = await handleWeeklyReviewCompletionRequest(
      completionRequest(validCompletion),
      environment,
      async () => sessionResponse(401),
      NOW_SECONDS,
    );
    assert.equal(unauthenticated.status, 401);

    let calls = 0;
    const conflict = await handleWeeklyReviewCompletionRequest(
      completionRequest(validCompletion),
      environment,
      async () => {
        calls += 1;
        return calls === 1
          ? sessionResponse()
          : Response.json(
              { title: 'sensitive upstream conflict detail' },
              { status: 409 },
            );
      },
      NOW_SECONDS,
    );
    assert.equal(conflict.status, 409);
    assert.deepEqual(await conflict.json(), {
      type: 'about:blank',
      title: 'Weekly Review completion conflicts with existing evidence',
      status: 409,
      code: 'review_completion_conflict',
    });
  });
});

describe('authenticated Review history BFF', () => {
  it('returns only bounded browser-safe immutable Review evidence', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const response = await handleReviewHistoryRequest(
      historyRequest('20'),
      environment,
      async (input, init) => {
        calls.push({ url: String(input), init });
        return calls.length === 1
          ? sessionResponse()
          : Response.json([
              completionRecord(),
              completionRecord({
                id: SECOND_REVIEW_ID,
                ritualKind: 'daily-shutdown',
                periodStartDate: '2026-09-01',
                reflection: null,
              }),
            ]);
      },
      NOW_SECONDS,
    );

    assert.equal(response.status, 200);
    const body = (await response.json()) as Array<Record<string, unknown>>;
    assert.equal(body.length, 2);
    assert.equal(body[0]?.id, REVIEW_ID);
    assert.equal(body[1]?.id, SECOND_REVIEW_ID);
    assert.equal('workspaceId' in (body[0] ?? {}), false);
    assert.equal('idempotencyKey' in (body[0] ?? {}), false);
    assert.equal('payloadDigest' in (body[0] ?? {}), false);
    assert.equal(
      calls[1]?.url,
      'http://review-service:4104/v1/reviews/completions?limit=20',
    );
    const headers = new Headers(calls[1]?.init?.headers);
    assert.equal(
      headers.get('x-life-os-context-signature'),
      createHmac('sha256', CONTEXT_SECRET)
        .update(
          `life-os.review-context.v1\n${WORKSPACE_ID}\n${NOW_SECONDS}\nGET\n/v1/reviews/completions`,
          'utf8',
        )
        .digest('base64url'),
    );
  });

  it('fails closed when Review returns more records than the requested limit', async () => {
    let calls = 0;
    const response = await handleReviewHistoryRequest(
      historyRequest('1'),
      environment,
      async () => {
        calls += 1;
        return calls === 1
          ? sessionResponse()
          : Response.json([
              completionRecord(),
              completionRecord({
                id: SECOND_REVIEW_ID,
                ritualKind: 'daily-shutdown',
                periodStartDate: '2026-09-01',
                reflection: null,
              }),
            ]);
      },
      NOW_SECONDS,
    );

    assert.equal(response.status, 503);
    assert.equal(calls, 2);
  });

  it('rejects malformed limits and cross-workspace dependency evidence', async () => {
    let called = false;
    const invalidLimit = await handleReviewHistoryRequest(
      historyRequest('0'),
      environment,
      async () => {
        called = true;
        return sessionResponse();
      },
      NOW_SECONDS,
    );
    assert.equal(invalidLimit.status, 400);
    assert.equal(called, false);

    let calls = 0;
    const wrongWorkspace = await handleReviewHistoryRequest(
      historyRequest('10'),
      environment,
      async () => {
        calls += 1;
        return calls === 1
          ? sessionResponse()
          : Response.json([
              completionRecord({
                workspaceId: '77777777-7777-4777-8777-777777777777',
              }),
            ]);
      },
      NOW_SECONDS,
    );
    assert.equal(wrongWorkspace.status, 503);
    assert.equal(calls, 2);
  });
});
