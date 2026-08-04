import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createWorkspaceContextHeaders,
  handlePlanningSearchRequest,
  parsePlanningSearchResults,
  parseSessionWorkspace,
  requireGatewayContextSecret,
  requireServiceOrigin,
  type PlanningSearchFetch,
} from './planning-search-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const GATEWAY_SECRET = 'trusted-gateway-context-secret-32-bytes';

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  PLANNING_SERVICE_ORIGIN: 'http://planning-service:4102',
  PLANNING_GATEWAY_CONTEXT_SECRET: GATEWAY_SECRET,
};

function sessionResponse(status = 200): Response {
  return new Response(
    JSON.stringify({
      sessionId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      workspaceId: WORKSPACE_ID,
      createdAt: '2026-08-04T01:00:00.000Z',
      expiresAt: '2026-08-05T01:00:00.000Z',
    }),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

function searchResponse(status = 200): Response {
  return new Response(
    JSON.stringify([
      {
        entityType: 'task',
        id: TASK_ID,
        title: 'Ship search',
        parentId: '55555555-5555-4555-8555-555555555555',
        status: 'todo',
        createdAt: '2026-08-04T02:00:00.000Z',
      },
    ]),
    { status, headers: { 'content-type': 'application/json' } },
  );
}

describe('planning search BFF', () => {
  it('derives and signs the workspace while forwarding no browser credential to planning', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: PlanningSearchFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1 ? sessionResponse() : searchResponse();
    };
    const request = new Request(
      'https://life-os.example/api/planning/search?q=Ship%20Search&limit=12',
      { headers: { cookie: 'life_os_session=opaque_session_value' } },
    );

    const response = await handlePlanningSearchRequest(
      request,
      environment,
      fetcher,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), [
      {
        entityType: 'task',
        id: TASK_ID,
        title: 'Ship search',
        parentId: '55555555-5555-4555-8555-555555555555',
        status: 'todo',
        createdAt: '2026-08-04T02:00:00.000Z',
      },
    ]);
    assert.equal(calls[0]?.url, 'http://identity-service:4101/v1/session');
    assert.equal(
      new Headers(calls[0]?.init?.headers).get('cookie'),
      'life_os_session=opaque_session_value',
    );
    assert.equal(
      calls[1]?.url,
      'http://planning-service:4102/v1/search?q=Ship+Search&limit=12',
    );
    const planningHeaders = new Headers(calls[1]?.init?.headers);
    assert.equal(
      planningHeaders.get('x-life-os-workspace-id'),
      WORKSPACE_ID,
    );
    assert.match(
      planningHeaders.get('x-life-os-context-issued-at') ?? '',
      /^[1-9]\d{9,12}$/,
    );
    assert.match(
      planningHeaders.get('x-life-os-context-signature') ?? '',
      /^[A-Za-z0-9_-]{43}$/,
    );
    assert.equal(planningHeaders.get('cookie'), null);
    assert.match(
      planningHeaders.get('x-correlation-id') ?? '',
      /^[a-f0-9-]{36}$/,
    );
    assert.equal(calls[0]?.init?.redirect, 'error');
    assert.equal(calls[1]?.init?.redirect, 'error');
  });

  it('rejects ownership injection and malformed browser input before fetch', async () => {
    const unsafeUrls = [
      'https://life-os.example/api/planning/search',
      `https://life-os.example/api/planning/search?q=ship&workspaceId=${WORKSPACE_ID}`,
      'https://life-os.example/api/planning/search?q=ship&q=again',
      'https://life-os.example/api/planning/search?q=1234',
      'https://life-os.example/api/planning/search?q=ship&limit=0',
      'https://life-os.example/api/planning/search?q=ship&limit=51',
    ];
    for (const url of unsafeUrls) {
      let called = false;
      const response = await handlePlanningSearchRequest(
        new Request(url),
        environment,
        async () => {
          called = true;
          return sessionResponse();
        },
      );
      assert.equal(response.status, 400);
      assert.equal(called, false);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Planning search request is invalid',
        status: 400,
        code: 'invalid_search_request',
      });
    }
  });

  it('maps an unauthenticated identity response without calling planning', async () => {
    let calls = 0;
    const response = await handlePlanningSearchRequest(
      new Request('https://life-os.example/api/planning/search?q=ship'),
      environment,
      async () => {
        calls += 1;
        return sessionResponse(401);
      },
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

  it('fails closed for unavailable configuration and malformed upstream responses', async () => {
    const invalidEnvironment = {
      ...environment,
      PLANNING_GATEWAY_CONTEXT_SECRET: 'short',
    };
    const malformedResponses: PlanningSearchFetch[] = [
      async () =>
        new Response('{}', { headers: { 'content-type': 'text/plain' } }),
      async () =>
        new Response('x'.repeat(17 * 1024), {
          headers: { 'content-type': 'application/json' },
        }),
      async () => {
        throw new Error('upstream secret must not escape');
      },
      async (input) =>
        String(input).includes('/v1/session')
          ? sessionResponse()
          : new Response('{}', {
              status: 503,
              headers: { 'content-type': 'application/json' },
            }),
      async (input) =>
        String(input).includes('/v1/session')
          ? sessionResponse()
          : new Response(JSON.stringify([{ id: 'numeric-7' }]), {
              headers: { 'content-type': 'application/json' },
            }),
    ];

    const missingSecretResponse = await handlePlanningSearchRequest(
      new Request('https://life-os.example/api/planning/search?q=ship'),
      invalidEnvironment,
      async () => sessionResponse(),
    );
    assert.equal(missingSecretResponse.status, 503);

    for (const fetcher of malformedResponses) {
      const response = await handlePlanningSearchRequest(
        new Request('https://life-os.example/api/planning/search?q=ship'),
        environment,
        fetcher,
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Planning search is unavailable',
        status: 503,
        code: 'planning_search_unavailable',
      });
    }
  });
});

describe('planning search validation and signing', () => {
  it('validates service origins, secret, workspace context, and bounded results', () => {
    assert.equal(
      requireServiceOrigin('https://identity.example.test', 'identity'),
      'https://identity.example.test',
    );
    assert.equal(requireGatewayContextSecret(GATEWAY_SECRET), GATEWAY_SECRET);
    assert.equal(
      parseSessionWorkspace({ workspaceId: WORKSPACE_ID.toUpperCase() }),
      WORKSPACE_ID,
    );
    const headers = createWorkspaceContextHeaders(
      WORKSPACE_ID,
      GATEWAY_SECRET,
      1_785_806_400,
    );
    assert.equal(headers['x-life-os-workspace-id'], WORKSPACE_ID);
    assert.equal(headers['x-life-os-context-issued-at'], '1785806400');
    assert.match(
      headers['x-life-os-context-signature'] ?? '',
      /^[A-Za-z0-9_-]{43}$/,
    );
    assert.deepEqual(
      parsePlanningSearchResults([
        {
          entityType: 'goal',
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Goal',
          createdAt: '2026-08-04T01:00:00.000Z',
        },
      ]),
      [
        {
          entityType: 'goal',
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Goal',
          createdAt: '2026-08-04T01:00:00.000Z',
        },
      ],
    );
  });

  it('rejects unsafe origins, secrets, sessions, timestamps, and result shapes', () => {
    for (const origin of [
      '',
      'ftp://identity.example.test',
      'https://user:password@identity.example.test',
      'https://identity.example.test/path',
      'https://identity.example.test?query=yes',
      'https://identity.example.test/#fragment',
    ]) {
      assert.throws(() => requireServiceOrigin(origin, 'identity'));
    }
    for (const secret of [undefined, '', 'too-short', `${'x'.repeat(32)}\n`]) {
      assert.throws(() => requireGatewayContextSecret(secret));
    }
    for (const value of [null, {}, { workspaceId: '123' }]) {
      assert.throws(() => parseSessionWorkspace(value));
    }
    assert.throws(() =>
      createWorkspaceContextHeaders(WORKSPACE_ID, GATEWAY_SECRET, -1),
    );
    for (const value of [
      null,
      {},
      Array.from({ length: 51 }, () => ({})),
      [{ entityType: 'habit' }],
      [{ entityType: 'goal', id: TASK_ID, title: '', createdAt: 'bad' }],
      [
        {
          entityType: 'goal',
          id: TASK_ID,
          title: 'Goal',
          parentId: TASK_ID,
          createdAt: '2026-08-04T01:00:00.000Z',
        },
      ],
      [
        {
          entityType: 'task',
          id: TASK_ID,
          title: 'Task',
          createdAt: '2026-08-04T01:00:00.000Z',
        },
      ],
    ]) {
      assert.throws(() => parsePlanningSearchResults(value));
    }
  });
});
