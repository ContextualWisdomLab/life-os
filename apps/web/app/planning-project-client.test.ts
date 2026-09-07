import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createPlanningContextHeaders } from './planning-search-client';
import {
  handlePlanningProjectCreateRequest,
  handlePlanningProjectListRequest,
  type PlanningGoalFetch,
} from './planning-goal-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '44444444-4444-4444-8444-444444444444';
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
      sessionId: '66666666-6666-4666-8666-666666666666',
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      createdAt: '2026-09-01T01:00:00.000Z',
      expiresAt: '2026-09-02T01:00:00.000Z',
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function projectResponse(
  overrides: Partial<
    Record<'id' | 'workspaceId' | 'goalId' | 'title' | 'createdAt', unknown>
  > = {},
): Response {
  return new Response(
    JSON.stringify({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      goalId: GOAL_ID,
      title: 'Ship authenticated planning workspace',
      createdAt: '2026-09-01T02:00:00.000Z',
      ...overrides,
    }),
    { status: 201, headers: { 'content-type': 'application/json' } },
  );
}

function projectListResponse(value?: unknown): Response {
  return new Response(
    JSON.stringify(
      value ?? [
        {
          id: PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          goalId: GOAL_ID,
          title: 'Ship authenticated planning workspace',
          createdAt: '2026-09-01T02:00:00.000Z',
        },
        {
          id: SECOND_PROJECT_ID,
          workspaceId: WORKSPACE_ID,
          goalId: GOAL_ID,
          title: 'Verify release candidate',
          createdAt: '2026-09-01T03:00:00.000Z',
        },
      ],
    ),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function createRequest(goalId: string, body: unknown): Request {
  return new Request(
    `https://life-os.example/api/planning/goals/${goalId}/projects`,
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

function listRequest(goalId: string): Request {
  return new Request(
    `https://life-os.example/api/planning/goals/${goalId}/projects`,
    { headers: { cookie: 'life_os_session=opaque_session_value' } },
  );
}

describe('authenticated planning project creation BFF', () => {
  it('derives workspace authority and binds the signed request to the parent goal', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: PlanningGoalFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1 ? sessionResponse() : projectResponse();
    };

    const response = await handlePlanningProjectCreateRequest(
      createRequest(GOAL_ID, { title: 'Ship authenticated planning workspace' }),
      GOAL_ID,
      environment,
      fetcher,
      NOW_SECONDS,
    );

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      id: PROJECT_ID,
      goalId: GOAL_ID,
      title: 'Ship authenticated planning workspace',
      createdAt: '2026-09-01T02:00:00.000Z',
    });
    assert.equal(calls[0]?.url, 'http://identity-service:4101/v1/session');
    assert.equal(
      new Headers(calls[0]?.init?.headers).get('cookie'),
      'life_os_session=opaque_session_value',
    );
    assert.equal(
      calls[1]?.url,
      `http://planning-service:4102/v1/goals/${GOAL_ID}/projects`,
    );
    assert.equal(calls[1]?.init?.method, 'POST');
    assert.equal(
      calls[1]?.init?.body,
      JSON.stringify({ title: 'Ship authenticated planning workspace' }),
    );

    const planningHeaders = new Headers(calls[1]?.init?.headers);
    const expected = createPlanningContextHeaders(
      WORKSPACE_ID,
      CONTEXT_SECRET,
      NOW_SECONDS,
      { method: 'POST', path: `/v1/goals/${GOAL_ID}/projects` },
    );
    assert.equal(
      planningHeaders.get('x-life-os-context-signature'),
      expected['x-life-os-context-signature'],
    );
    assert.equal(planningHeaders.get('cookie'), null);
  });

  it('rejects invalid parent identifiers and injected authority before dependency access', async () => {
    const cases: Array<{ goalId: string; body: unknown }> = [
      { goalId: 'not-a-uuid', body: { title: 'Valid title' } },
      { goalId: GOAL_ID, body: null },
      { goalId: GOAL_ID, body: {} },
      { goalId: GOAL_ID, body: { title: '' } },
      { goalId: GOAL_ID, body: { title: 'x'.repeat(161) } },
      { goalId: GOAL_ID, body: { title: 'valid', goalId: GOAL_ID } },
      { goalId: GOAL_ID, body: { title: 'valid', workspaceId: WORKSPACE_ID } },
    ];

    for (const entry of cases) {
      let called = false;
      const response = await handlePlanningProjectCreateRequest(
        createRequest(entry.goalId, entry.body),
        entry.goalId,
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
        title: 'Project request is invalid',
        status: 400,
        code: 'invalid_project_request',
      });
    }
  });

  it('fails closed when Planning returns mismatched ownership or parent evidence', async () => {
    const invalidResponses = [
      projectResponse({ workspaceId: SECOND_PROJECT_ID }),
      projectResponse({ goalId: SECOND_PROJECT_ID }),
      projectResponse({ id: 'not-a-uuid' }),
      projectResponse({ title: 7 }),
      projectResponse({ createdAt: 'not-a-time' }),
    ];

    for (const invalidResponse of invalidResponses) {
      let calls = 0;
      const response = await handlePlanningProjectCreateRequest(
        createRequest(GOAL_ID, { title: 'Valid project' }),
        GOAL_ID,
        environment,
        async () => {
          calls += 1;
          return calls === 1 ? sessionResponse() : invalidResponse;
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 503);
      assert.equal(calls, 2);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Project creation is unavailable',
        status: 503,
        code: 'project_creation_unavailable',
      });
    }
  });
});

describe('authenticated planning project listing BFF', () => {
  it('lists browser-safe projects only under the server-derived workspace and requested goal', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const response = await handlePlanningProjectListRequest(
      listRequest(GOAL_ID),
      GOAL_ID,
      environment,
      async (input, init) => {
        calls.push({ url: String(input), init });
        return calls.length === 1 ? sessionResponse() : projectListResponse();
      },
      NOW_SECONDS,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      {
        id: PROJECT_ID,
        goalId: GOAL_ID,
        title: 'Ship authenticated planning workspace',
        createdAt: '2026-09-01T02:00:00.000Z',
      },
      {
        id: SECOND_PROJECT_ID,
        goalId: GOAL_ID,
        title: 'Verify release candidate',
        createdAt: '2026-09-01T03:00:00.000Z',
      },
    ]);
    assert.equal(
      calls[1]?.url,
      `http://planning-service:4102/v1/goals/${GOAL_ID}/projects`,
    );
    assert.equal(calls[1]?.init?.method, 'GET');
    const planningHeaders = new Headers(calls[1]?.init?.headers);
    const expected = createPlanningContextHeaders(
      WORKSPACE_ID,
      CONTEXT_SECRET,
      NOW_SECONDS,
      { method: 'GET', path: `/v1/goals/${GOAL_ID}/projects` },
    );
    assert.equal(
      planningHeaders.get('x-life-os-context-signature'),
      expected['x-life-os-context-signature'],
    );
    assert.equal(planningHeaders.get('cookie'), null);
  });

  it('rejects cross-scope, duplicate, oversized, and malformed collections', async () => {
    const baseProject = {
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      goalId: GOAL_ID,
      title: 'Project',
      createdAt: '2026-09-01T02:00:00.000Z',
    };
    const invalidCollections = [
      [{ ...baseProject, workspaceId: SECOND_PROJECT_ID }],
      [{ ...baseProject, goalId: SECOND_PROJECT_ID }],
      [baseProject, { ...baseProject, title: 'Duplicate identity' }],
      Array.from({ length: 101 }, (_, index) => ({
        ...baseProject,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        title: `Project ${index}`,
      })),
      { projects: [] },
    ];

    for (const collection of invalidCollections) {
      let calls = 0;
      const response = await handlePlanningProjectListRequest(
        listRequest(GOAL_ID),
        GOAL_ID,
        environment,
        async () => {
          calls += 1;
          return calls === 1
            ? sessionResponse()
            : projectListResponse(collection);
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 503);
      assert.equal(calls, 2);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Project listing is unavailable',
        status: 503,
        code: 'project_listing_unavailable',
      });
    }
  });
});
