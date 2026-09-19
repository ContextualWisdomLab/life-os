import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPlanningContextHeaders } from './planning-search-client';
import {
  handlePlanningGoalCreateRequest,
  handlePlanningGoalListRequest,
  type PlanningGoalFetch,
} from './planning-goal-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_GOAL_ID = '55555555-5555-4555-8555-555555555555';
const CONTEXT_SECRET = 'planning-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_788_220_800;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  PLANNING_SERVICE_ORIGIN: 'http://planning-service:4102',
  PLANNING_GATEWAY_CONTEXT_SECRET: CONTEXT_SECRET,
};

function sessionResponse(status = 200): Response {
  return new Response(
    JSON.stringify({
      sessionId: '33333333-3333-4333-8333-333333333333',
      userId: '44444444-4444-4444-8444-444444444444',
      workspaceId: WORKSPACE_ID,
      createdAt: '2026-09-01T01:00:00.000Z',
      expiresAt: '2026-09-02T01:00:00.000Z',
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function goalResponse(
  overrides: Partial<Record<'id' | 'workspaceId' | 'title' | 'createdAt', unknown>> = {},
): Response {
  return new Response(
    JSON.stringify({
      id: GOAL_ID,
      workspaceId: WORKSPACE_ID,
      title: 'Publish the first LifeOS release candidate',
      createdAt: '2026-09-01T02:00:00.000Z',
      ...overrides,
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
}

function goalListResponse(value?: unknown): Response {
  return new Response(
    JSON.stringify(
      value ?? [
        {
          id: GOAL_ID,
          workspaceId: WORKSPACE_ID,
          title: 'Publish the first LifeOS release candidate',
          createdAt: '2026-09-01T02:00:00.000Z',
        },
        {
          id: SECOND_GOAL_ID,
          workspaceId: WORKSPACE_ID,
          title: 'Complete the first-party workspace',
          createdAt: '2026-09-01T03:00:00.000Z',
        },
      ],
    ),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function createRequest(body: unknown): Request {
  return new Request('https://life-os.example/api/planning/goals', {
    method: 'POST',
    headers: {
      cookie: 'life_os_session=opaque_session_value',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function listRequest(): Request {
  return new Request('https://life-os.example/api/planning/goals', {
    headers: { cookie: 'life_os_session=opaque_session_value' },
  });
}

describe('authenticated planning goal creation BFF', () => {
  it('derives workspace authority from identity and never forwards browser credentials', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: PlanningGoalFetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      return calls.length === 1 ? sessionResponse() : goalResponse();
    };

    const response = await handlePlanningGoalCreateRequest(
      createRequest({ title: 'Publish the first LifeOS release candidate' }),
      environment,
      fetcher,
      NOW_SECONDS,
    );

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      id: GOAL_ID,
      title: 'Publish the first LifeOS release candidate',
      createdAt: '2026-09-01T02:00:00.000Z',
    });

    assert.equal(calls[0]?.url, 'http://identity-service:4101/v1/session');
    assert.equal(
      new Headers(calls[0]?.init?.headers).get('cookie'),
      'life_os_session=opaque_session_value',
    );
    assert.equal(calls[1]?.url, 'http://planning-service:4102/v1/goals');
    assert.equal(calls[1]?.init?.method, 'POST');
    assert.equal(
      calls[1]?.init?.body,
      JSON.stringify({ title: 'Publish the first LifeOS release candidate' }),
    );

    const planningHeaders = new Headers(calls[1]?.init?.headers);
    const expected = createPlanningContextHeaders(
      WORKSPACE_ID,
      CONTEXT_SECRET,
      NOW_SECONDS,
      { method: 'POST', path: '/v1/goals' },
    );
    assert.equal(
      planningHeaders.get('x-life-os-workspace-id'),
      expected['x-life-os-workspace-id'],
    );
    assert.equal(
      planningHeaders.get('x-life-os-context-issued-at'),
      expected['x-life-os-context-issued-at'],
    );
    assert.equal(
      planningHeaders.get('x-life-os-context-signature'),
      expected['x-life-os-context-signature'],
    );
    assert.equal(planningHeaders.get('cookie'), null);
    assert.equal(planningHeaders.get('content-type'), 'application/json');
    assert.equal(calls[0]?.init?.redirect, 'error');
    assert.equal(calls[1]?.init?.redirect, 'error');
  });

  it('rejects injected authority and malformed bodies before any dependency call', async () => {
    const invalidBodies = [
      null,
      [],
      {},
      { title: '' },
      { title: 'x'.repeat(161) },
      { title: 'valid', workspaceId: WORKSPACE_ID },
      { title: 'line\nbreak' },
    ];

    for (const body of invalidBodies) {
      let called = false;
      const response = await handlePlanningGoalCreateRequest(
        createRequest(body),
        environment,
        async () => {
          called = true;
          return sessionResponse();
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 400);
      assert.equal(called, false);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Goal request is invalid',
        status: 400,
        code: 'invalid_goal_request',
      });
    }
  });

  it('requires authentication without calling planning', async () => {
    let calls = 0;
    const response = await handlePlanningGoalCreateRequest(
      createRequest({ title: 'Authenticated goal' }),
      environment,
      async () => {
        calls += 1;
        return sessionResponse(401);
      },
      NOW_SECONDS,
    );

    assert.equal(response.status, 401);
    assert.equal(calls, 1);
    assert.deepEqual(await response.json(), {
      type: 'about:blank',
      title: 'Authentication is required',
      status: 401,
      code: 'authentication_required',
    });
  });

  it('fails closed when planning returns ownership or schema evidence that disagrees with the session', async () => {
    const invalidGoalResponses = [
      goalResponse({
        workspaceId: '55555555-5555-4555-8555-555555555555',
      }),
      goalResponse({ id: 'not-a-uuid' }),
      goalResponse({ title: 7 }),
      goalResponse({ createdAt: 'not-a-time' }),
    ];

    for (const invalidGoalResponse of invalidGoalResponses) {
      let calls = 0;
      const response = await handlePlanningGoalCreateRequest(
        createRequest({ title: 'Authenticated goal' }),
        environment,
        async () => {
          calls += 1;
          return calls === 1 ? sessionResponse() : invalidGoalResponse;
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 503);
      assert.equal(calls, 2);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Goal creation is unavailable',
        status: 503,
        code: 'goal_creation_unavailable',
      });
    }
  });
});

describe('authenticated planning goal listing BFF', () => {
  it('lists only browser-safe goals under the server-derived workspace', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const response = await handlePlanningGoalListRequest(
      listRequest(),
      environment,
      async (input, init) => {
        calls.push({ url: String(input), init });
        return calls.length === 1 ? sessionResponse() : goalListResponse();
      },
      NOW_SECONDS,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      {
        id: GOAL_ID,
        title: 'Publish the first LifeOS release candidate',
        createdAt: '2026-09-01T02:00:00.000Z',
      },
      {
        id: SECOND_GOAL_ID,
        title: 'Complete the first-party workspace',
        createdAt: '2026-09-01T03:00:00.000Z',
      },
    ]);
    assert.equal(calls[1]?.url, 'http://planning-service:4102/v1/goals');
    assert.equal(calls[1]?.init?.method, 'GET');
    const planningHeaders = new Headers(calls[1]?.init?.headers);
    const expected = createPlanningContextHeaders(
      WORKSPACE_ID,
      CONTEXT_SECRET,
      NOW_SECONDS,
      { method: 'GET', path: '/v1/goals' },
    );
    assert.equal(
      planningHeaders.get('x-life-os-context-signature'),
      expected['x-life-os-context-signature'],
    );
    assert.equal(planningHeaders.get('cookie'), null);
  });

  it('rejects cross-workspace, oversized, and malformed goal collections', async () => {
    const invalidCollections = [
      [
        {
          id: GOAL_ID,
          workspaceId: SECOND_GOAL_ID,
          title: 'Wrong workspace',
          createdAt: '2026-09-01T02:00:00.000Z',
        },
      ],
      Array.from({ length: 101 }, (_, index) => ({
        id: `${String(index).padStart(8, '0')}-1111-4111-8111-111111111111`,
        workspaceId: WORKSPACE_ID,
        title: `Goal ${index}`,
        createdAt: '2026-09-01T02:00:00.000Z',
      })),
      { goals: [] },
    ];

    for (const collection of invalidCollections) {
      let calls = 0;
      const response = await handlePlanningGoalListRequest(
        listRequest(),
        environment,
        async () => {
          calls += 1;
          return calls === 1 ? sessionResponse() : goalListResponse(collection);
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 503);
      assert.equal(calls, 2);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Goal listing is unavailable',
        status: 503,
        code: 'goal_listing_unavailable',
      });
    }
  });
});
