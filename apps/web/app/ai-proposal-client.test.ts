import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  createAiContextHeaders,
  handleAiProposalRequest,
  parseAiSessionPrincipal,
  requireAiGatewaySecret,
  requireAiServiceOrigin,
  type AiProposalFetch,
  type AiProposalRoute,
} from './ai-proposal-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';
const TASK_ID = '55555555-5555-4555-8555-555555555555';
const DECISION_ID = '66666666-6666-4666-8666-666666666666';
const IDEMPOTENCY_KEY = '77777777-7777-4777-8777-777777777777';
const GATEWAY_SECRET = 'trusted-ai-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_785_806_400;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  AI_SERVICE_ORIGIN: 'http://ai-service:4105',
  AI_GATEWAY_CONTEXT_SECRET: GATEWAY_SECRET,
};

const proposalRequest = {
  objective: 'Ship authenticated AI proposal review',
  context: [
    {
      id: TASK_ID,
      kind: 'task',
      title: 'Review the authenticated AI boundary',
      status: 'active',
    },
  ],
} as const;

const proposal = {
  proposalId: PROPOSAL_ID,
  workspaceId: WORKSPACE_ID,
  summary: 'Prioritize authenticated AI review.',
  rationale: [
    'The task is active and supports the objective.',
    'No user-owned record changes without confirmation.',
  ],
  operations: [
    {
      kind: 'prioritize_item',
      targetId: TASK_ID,
      description: 'Prioritize the authenticated AI review task.',
    },
  ],
  requiresConfirmation: true,
  createdAt: '2026-08-04T11:00:00.000Z',
} as const;

const auditRecord = {
  proposal,
  request: proposalRequest,
  modelId: 'rule-based-v1',
  requestDigest: 'a'.repeat(64),
  contentDigest: 'b'.repeat(64),
  recordedAt: '2026-08-04T11:00:01.000Z',
} as const;

const decisionRequest = {
  expectedContentDigest: auditRecord.contentDigest,
  idempotencyKey: IDEMPOTENCY_KEY,
  decision: 'accepted',
  reason: 'Reviewed without executing any proposed operation.',
  decidedAt: '2026-08-04T11:00:02.000Z',
} as const;

const decisionEvent = {
  id: DECISION_ID,
  workspaceId: WORKSPACE_ID,
  proposalId: PROPOSAL_ID,
  proposalContentDigest: auditRecord.contentDigest,
  actorId: ACTOR_ID,
  decision: 'accepted',
  reason: decisionRequest.reason,
  idempotencyKey: IDEMPOTENCY_KEY,
  decidedAt: decisionRequest.decidedAt,
  recordedAt: '2026-08-04T11:00:03.000Z',
} as const;

/** Creates one bounded JSON response for deterministic dependency simulation. */
function jsonResponse(
  value: unknown,
  status = 200,
  contentType = 'application/json',
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': contentType },
  });
}

/** Creates the public identity session response used by the BFF. */
function sessionResponse(
  status = 200,
  overrides: Readonly<Record<string, unknown>> = {},
): Response {
  return jsonResponse(
    {
      sessionId: SESSION_ID,
      userId: ACTOR_ID,
      workspaceId: WORKSPACE_ID,
      createdAt: '2026-08-04T10:00:00.000Z',
      expiresAt: '2026-08-05T10:00:00.000Z',
      ...overrides,
    },
    status,
  );
}

/** Builds one same-origin browser request with optional JSON body. */
function browserRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  headers: Readonly<Record<string, string>> = {},
): Request {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Request(`https://life-os.example${path}`, {
    method,
    headers: {
      cookie: 'life_os_session=opaque_session_value',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: payload,
  });
}

/** Returns the expected HMAC for one exact AI upstream request. */
function expectedSignature(method: string, path: string): string {
  return createHmac('sha256', GATEWAY_SECRET)
    .update(
      `life-os.ai-context.v1\n${WORKSPACE_ID}\n${ACTOR_ID}\n${NOW_SECONDS}\n${method}\n${path}`,
      'utf8',
    )
    .digest('base64url');
}

/** Creates a two-hop dependency simulator and records both calls. */
function successfulFetcher(
  upstream: unknown,
  status = 200,
): {
  calls: Array<{ url: string; init: RequestInit | undefined }>;
  fetcher: AiProposalFetch;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  return {
    calls,
    fetcher: async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1
        ? sessionResponse()
        : jsonResponse(upstream, status);
    },
  };
}

describe('authenticated AI proposal BFF', () => {
  it('derives scope from identity and never forwards browser credentials', async () => {
    const { calls, fetcher } = successfulFetcher(proposal, 201);
    const response = await handleAiProposalRequest(
      browserRequest('POST', '/api/ai/proposals', proposalRequest, {
        authorization: 'Bearer browser-token',
        'x-workspace-id': randomUUID(),
        'x-actor-id': randomUUID(),
      }),
      environment,
      { kind: 'collection' },
      fetcher,
      NOW_SECONDS,
    );

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), proposal);
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'http://identity-service:4101/v1/session');
    const identityHeaders = new Headers(calls[0]?.init?.headers);
    assert.equal(
      identityHeaders.get('cookie'),
      'life_os_session=opaque_session_value',
    );
    assert.match(
      identityHeaders.get('x-correlation-id') ?? '',
      /^[a-f0-9-]{36}$/u,
    );

    assert.equal(calls[1]?.url, 'http://ai-service:4105/v1/proposals');
    const aiHeaders = new Headers(calls[1]?.init?.headers);
    assert.equal(aiHeaders.get('cookie'), null);
    assert.equal(aiHeaders.get('authorization'), null);
    assert.equal(aiHeaders.get('x-workspace-id'), null);
    assert.equal(aiHeaders.get('x-actor-id'), null);
    assert.equal(aiHeaders.get('x-life-os-workspace-id'), WORKSPACE_ID);
    assert.equal(aiHeaders.get('x-life-os-actor-id'), ACTOR_ID);
    assert.equal(
      aiHeaders.get('x-life-os-context-issued-at'),
      String(NOW_SECONDS),
    );
    assert.equal(
      aiHeaders.get('x-life-os-context-signature'),
      expectedSignature('POST', '/v1/proposals'),
    );
    assert.equal(
      aiHeaders.get('x-correlation-id'),
      identityHeaders.get('x-correlation-id'),
    );
    assert.equal(calls[0]?.init?.redirect, 'error');
    assert.equal(calls[1]?.init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), proposalRequest);
  });

  it('translates every supported route to its exact method-bound upstream path', async () => {
    const cases: Array<{
      method: 'GET' | 'POST';
      browserPath: string;
      route: AiProposalRoute;
      expectedPath: string;
      upstreamBody?: unknown;
      upstreamResponse: unknown;
      expectedStatus: number;
    }> = [
      {
        method: 'GET',
        browserPath: '/api/ai/proposals',
        route: { kind: 'collection' },
        expectedPath: '/v1/proposals',
        upstreamResponse: [auditRecord],
        expectedStatus: 200,
      },
      {
        method: 'GET',
        browserPath: `/api/ai/proposals/${PROPOSAL_ID}`,
        route: { kind: 'proposal', proposalId: PROPOSAL_ID },
        expectedPath: `/v1/proposals/${PROPOSAL_ID}`,
        upstreamResponse: auditRecord,
        expectedStatus: 200,
      },
      {
        method: 'GET',
        browserPath: `/api/ai/proposals/${PROPOSAL_ID}/decisions`,
        route: { kind: 'decisions', proposalId: PROPOSAL_ID },
        expectedPath: `/v1/proposals/${PROPOSAL_ID}/decisions`,
        upstreamResponse: [decisionEvent],
        expectedStatus: 200,
      },
      {
        method: 'POST',
        browserPath: `/api/ai/proposals/${PROPOSAL_ID}/decisions`,
        route: { kind: 'decisions', proposalId: PROPOSAL_ID },
        expectedPath: `/v1/proposals/${PROPOSAL_ID}/decisions`,
        upstreamBody: decisionRequest,
        upstreamResponse: decisionEvent,
        expectedStatus: 201,
      },
    ];

    for (const testCase of cases) {
      const { calls, fetcher } = successfulFetcher(
        testCase.upstreamResponse,
        testCase.expectedStatus,
      );
      const response = await handleAiProposalRequest(
        browserRequest(
          testCase.method,
          testCase.browserPath,
          testCase.upstreamBody,
        ),
        environment,
        testCase.route,
        fetcher,
        NOW_SECONDS,
      );

      assert.equal(response.status, testCase.expectedStatus);
      assert.equal(
        calls[1]?.url,
        `http://ai-service:4105${testCase.expectedPath}`,
      );
      const headers = new Headers(calls[1]?.init?.headers);
      assert.equal(
        headers.get('x-life-os-context-signature'),
        expectedSignature(testCase.method, testCase.expectedPath),
      );
    }
  });

  it('rejects malformed browser requests before any dependency call', async () => {
    const unsafeRequests: Array<{
      request: Request;
      route: AiProposalRoute;
    }> = [
      {
        request: browserRequest('GET', '/api/ai/proposals?workspaceId=other'),
        route: { kind: 'collection' },
      },
      {
        request: new Request('https://life-os.example/api/ai/proposals', {
          method: 'PUT',
        }),
        route: { kind: 'collection' },
      },
      {
        request: browserRequest('GET', '/api/ai/proposals/not-a-uuid'),
        route: { kind: 'proposal', proposalId: 'not-a-uuid' },
      },
      {
        request: browserRequest('POST', '/api/ai/proposals', {
          ...proposalRequest,
          workspaceId: WORKSPACE_ID,
        }),
        route: { kind: 'collection' },
      },
      {
        request: browserRequest(
          'POST',
          `/api/ai/proposals/${PROPOSAL_ID}/decisions`,
          { ...decisionRequest, actorId: ACTOR_ID },
        ),
        route: { kind: 'decisions', proposalId: PROPOSAL_ID },
      },
      {
        request: browserRequest(
          'POST',
          '/api/ai/proposals',
          proposalRequest,
          { 'content-type': 'text/plain' },
        ),
        route: { kind: 'collection' },
      },
      {
        request: browserRequest('POST', '/api/ai/proposals'),
        route: { kind: 'collection' },
      },
    ];

    for (const unsafe of unsafeRequests) {
      let called = false;
      const response = await handleAiProposalRequest(
        unsafe.request,
        environment,
        unsafe.route,
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
        title: 'AI proposal request is invalid',
        status: 400,
        code: 'invalid_ai_request',
      });
    }
  });

  it('rejects oversized cookies and bodies before dependency calls', async () => {
    const oversizedCookie = browserRequest('GET', '/api/ai/proposals', undefined, {
      cookie: `life_os_session=${'x'.repeat(4096)}`,
    });
    const oversizedBody = new Request('https://life-os.example/api/ai/proposals', {
      method: 'POST',
      headers: {
        cookie: 'life_os_session=opaque',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        objective: 'x'.repeat(33 * 1024),
        context: [],
      }),
    });

    for (const request of [oversizedCookie, oversizedBody]) {
      let called = false;
      const response = await handleAiProposalRequest(
        request,
        environment,
        { kind: 'collection' },
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

  it('maps unauthenticated sessions without calling AI service', async () => {
    let calls = 0;
    const response = await handleAiProposalRequest(
      browserRequest('GET', '/api/ai/proposals'),
      environment,
      { kind: 'collection' },
      async () => {
        calls += 1;
        return sessionResponse(401);
      },
      NOW_SECONDS,
    );

    assert.equal(calls, 1);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      type: 'about:blank',
      title: 'Authentication is required',
      status: 401,
      code: 'authentication_required',
    });
  });

  it('passes through only reconstructed tenant-safe absence and conflict problems', async () => {
    const safeProblems = [
      {
        status: 404,
        code: 'proposal_not_found',
        title: 'Proposal was not found',
      },
      {
        status: 409,
        code: 'stale_proposal',
        title: 'Proposal revision is stale',
      },
      {
        status: 409,
        code: 'idempotency_conflict',
        title: 'Decision idempotency key conflicts with an earlier request',
      },
    ] as const;

    for (const safeProblem of safeProblems) {
      let calls = 0;
      const response = await handleAiProposalRequest(
        browserRequest('GET', `/api/ai/proposals/${PROPOSAL_ID}`),
        environment,
        { kind: 'proposal', proposalId: PROPOSAL_ID },
        async () => {
          calls += 1;
          return calls === 1
            ? sessionResponse()
            : jsonResponse(
                {
                  type: 'about:blank',
                  title: 'Untrusted upstream title',
                  status: safeProblem.status,
                  code: safeProblem.code,
                },
                safeProblem.status,
                'application/problem+json',
              );
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, safeProblem.status);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: safeProblem.title,
        status: safeProblem.status,
        code: safeProblem.code,
      });
    }
  });

  it('sanitizes invalid configuration, dependency failures, and malformed responses', async () => {
    const cases: Array<{
      environment?: Readonly<Record<string, string | undefined>>;
      fetcher: AiProposalFetch;
    }> = [
      {
        environment: { ...environment, AI_GATEWAY_CONTEXT_SECRET: 'short' },
        fetcher: async () => sessionResponse(),
      },
      {
        environment: {
          ...environment,
          AI_SERVICE_ORIGIN: 'https://user:secret@ai.example',
        },
        fetcher: async () => sessionResponse(),
      },
      {
        fetcher: async () => sessionResponse(200, { userId: 'not-a-uuid' }),
      },
      {
        fetcher: async () => {
          throw new Error('dependency secret must not escape');
        },
      },
      {
        fetcher: async (input) =>
          String(input).includes('/v1/session')
            ? sessionResponse()
            : new Response('{}', {
                headers: { 'content-type': 'text/plain' },
              }),
      },
      {
        fetcher: async (input) =>
          String(input).includes('/v1/session')
            ? sessionResponse()
            : new Response('x'.repeat(33 * 1024), {
                headers: { 'content-type': 'application/json' },
              }),
      },
      {
        fetcher: async (input) =>
          String(input).includes('/v1/session')
            ? sessionResponse()
            : jsonResponse({ proposalId: 'not-a-uuid' }, 201),
      },
      {
        fetcher: async (input) =>
          String(input).includes('/v1/session')
            ? sessionResponse()
            : jsonResponse(
                {
                  type: 'about:blank',
                  title: 'Internal details must not pass through',
                  status: 503,
                  code: 'database_password_leak',
                },
                503,
                'application/problem+json',
              ),
      },
    ];

    for (const testCase of cases) {
      const response = await handleAiProposalRequest(
        browserRequest('POST', '/api/ai/proposals', proposalRequest),
        testCase.environment ?? environment,
        { kind: 'collection' },
        testCase.fetcher,
        NOW_SECONDS,
      );
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'AI proposal service is unavailable',
        status: 503,
        code: 'ai_proposal_unavailable',
      });
    }
  });
});

describe('AI proposal BFF helpers', () => {
  it('validates origins, secrets, session principals, and exact signatures', () => {
    assert.equal(
      requireAiServiceOrigin('https://ai.example.test'),
      'https://ai.example.test',
    );
    assert.equal(requireAiGatewaySecret(GATEWAY_SECRET), GATEWAY_SECRET);
    assert.deepEqual(
      parseAiSessionPrincipal({
        sessionId: SESSION_ID,
        userId: ACTOR_ID.toUpperCase(),
        workspaceId: WORKSPACE_ID.toUpperCase(),
        createdAt: '2026-08-04T10:00:00.000Z',
        expiresAt: '2026-08-05T10:00:00.000Z',
      }),
      { workspaceId: WORKSPACE_ID, actorId: ACTOR_ID },
    );
    const headers = createAiContextHeaders(
      WORKSPACE_ID,
      ACTOR_ID,
      GATEWAY_SECRET,
      NOW_SECONDS,
      'POST',
      `/v1/proposals/${PROPOSAL_ID}/decisions`,
    );
    assert.equal(headers['x-life-os-workspace-id'], WORKSPACE_ID);
    assert.equal(headers['x-life-os-actor-id'], ACTOR_ID);
    assert.equal(
      headers['x-life-os-context-issued-at'],
      String(NOW_SECONDS),
    );
    assert.equal(
      headers['x-life-os-context-signature'],
      expectedSignature('POST', `/v1/proposals/${PROPOSAL_ID}/decisions`),
    );
  });

  it('rejects unsafe helper inputs', () => {
    for (const origin of [
      '',
      'ftp://ai.example.test',
      'https://user:password@ai.example.test',
      'https://ai.example.test/path',
      'https://ai.example.test?query=yes',
      'https://ai.example.test/#fragment',
    ]) {
      assert.throws(
        () => requireAiServiceOrigin(origin),
        new Error('AI service origin is invalid'),
      );
    }
    for (const secret of [
      '',
      'short',
      'x'.repeat(4097),
      `x${String.fromCharCode(0)}y`,
    ]) {
      assert.throws(
        () => requireAiGatewaySecret(secret),
        new Error('AI gateway context secret is invalid'),
      );
    }
    for (const session of [
      null,
      {},
      { userId: ACTOR_ID, workspaceId: 'not-a-uuid' },
      { userId: 'not-a-uuid', workspaceId: WORKSPACE_ID },
    ]) {
      assert.throws(
        () => parseAiSessionPrincipal(session),
        new Error('Identity session response is invalid'),
      );
    }
    assert.throws(
      () =>
        createAiContextHeaders(
          WORKSPACE_ID,
          ACTOR_ID,
          GATEWAY_SECRET,
          -1,
          'POST',
          '/v1/proposals',
        ),
      new Error('AI gateway context is invalid'),
    );
  });
});
