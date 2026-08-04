import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET as getCollection, POST as postCollection } from './route';
import { GET as getProposal } from './[proposalId]/route';
import {
  GET as getDecisions,
  POST as postDecision,
} from './[proposalId]/decisions/route';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';
const TASK_ID = '55555555-5555-4555-8555-555555555555';
const DECISION_ID = '66666666-6666-4666-8666-666666666666';
const IDEMPOTENCY_KEY = '77777777-7777-4777-8777-777777777777';
const SECRET = 'trusted-ai-gateway-context-secret-32-bytes';

const proposalRequest = {
  objective: 'Verify route delegation',
  context: [
    {
      id: TASK_ID,
      kind: 'task',
      title: 'Exercise the authenticated route',
      status: 'active',
    },
  ],
} as const;

const proposal = {
  proposalId: PROPOSAL_ID,
  workspaceId: WORKSPACE_ID,
  summary: 'Review the authenticated route.',
  rationale: ['The route is part of the required browser boundary.'],
  operations: [
    {
      kind: 'prioritize_item',
      targetId: TASK_ID,
      description: 'Prioritize route verification.',
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
  decidedAt: '2026-08-04T11:00:02.000Z',
} as const;

const decisionEvent = {
  id: DECISION_ID,
  workspaceId: WORKSPACE_ID,
  proposalId: PROPOSAL_ID,
  proposalContentDigest: auditRecord.contentDigest,
  actorId: ACTOR_ID,
  decision: 'accepted',
  idempotencyKey: IDEMPOTENCY_KEY,
  decidedAt: decisionRequest.decidedAt,
  recordedAt: '2026-08-04T11:00:03.000Z',
} as const;

/** Creates one deterministic JSON dependency response. */
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/** Creates one same-origin route request with optional JSON. */
function request(method: 'GET' | 'POST', path: string, body?: unknown): Request {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Request(`https://life-os.example${path}`, {
    method,
    headers: {
      cookie: 'life_os_session=opaque',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: payload }),
  });
}

describe('AI proposal Next.js route handlers', () => {
  it('delegates collection and awaited dynamic routes to the authenticated BFF', async () => {
    const originalFetch = globalThis.fetch;
    const originalIdentityOrigin = process.env.IDENTITY_SERVICE_ORIGIN;
    const originalAiOrigin = process.env.AI_SERVICE_ORIGIN;
    const originalSecret = process.env.AI_GATEWAY_CONTEXT_SECRET;
    const aiCalls: Array<{ method: string; path: string }> = [];
    process.env.IDENTITY_SERVICE_ORIGIN = 'http://identity-service:4101';
    process.env.AI_SERVICE_ORIGIN = 'http://ai-service:4105';
    process.env.AI_GATEWAY_CONTEXT_SECRET = SECRET;
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/session') {
        return json({
          sessionId: SESSION_ID,
          userId: ACTOR_ID,
          workspaceId: WORKSPACE_ID,
          createdAt: '2026-08-04T10:00:00.000Z',
          expiresAt: '2026-08-05T10:00:00.000Z',
        });
      }
      const method = init?.method ?? 'GET';
      aiCalls.push({ method, path: url.pathname });
      if (url.pathname === '/v1/proposals' && method === 'POST') {
        return json(proposal, 201);
      }
      if (url.pathname === '/v1/proposals' && method === 'GET') {
        return json([auditRecord]);
      }
      if (url.pathname === `/v1/proposals/${PROPOSAL_ID}`) {
        return json(auditRecord);
      }
      if (
        url.pathname === `/v1/proposals/${PROPOSAL_ID}/decisions` &&
        method === 'POST'
      ) {
        return json(decisionEvent, 201);
      }
      return json([]);
    };

    try {
      assert.equal(
        (
          await getCollection(request('GET', '/api/ai/proposals'))
        ).status,
        200,
      );
      assert.equal(
        (
          await postCollection(
            request('POST', '/api/ai/proposals', proposalRequest),
          )
        ).status,
        201,
      );
      assert.equal(
        (
          await getProposal(
            request('GET', `/api/ai/proposals/${PROPOSAL_ID}`),
            { params: Promise.resolve({ proposalId: PROPOSAL_ID }) },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await getDecisions(
            request(
              'GET',
              `/api/ai/proposals/${PROPOSAL_ID}/decisions`,
            ),
            { params: Promise.resolve({ proposalId: PROPOSAL_ID }) },
          )
        ).status,
        200,
      );
      assert.equal(
        (
          await postDecision(
            request(
              'POST',
              `/api/ai/proposals/${PROPOSAL_ID}/decisions`,
              decisionRequest,
            ),
            { params: Promise.resolve({ proposalId: PROPOSAL_ID }) },
          )
        ).status,
        201,
      );
      assert.deepEqual(aiCalls, [
        { method: 'GET', path: '/v1/proposals' },
        { method: 'POST', path: '/v1/proposals' },
        { method: 'GET', path: `/v1/proposals/${PROPOSAL_ID}` },
        {
          method: 'GET',
          path: `/v1/proposals/${PROPOSAL_ID}/decisions`,
        },
        {
          method: 'POST',
          path: `/v1/proposals/${PROPOSAL_ID}/decisions`,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalIdentityOrigin === undefined) {
        delete process.env.IDENTITY_SERVICE_ORIGIN;
      } else {
        process.env.IDENTITY_SERVICE_ORIGIN = originalIdentityOrigin;
      }
      if (originalAiOrigin === undefined) {
        delete process.env.AI_SERVICE_ORIGIN;
      } else {
        process.env.AI_SERVICE_ORIGIN = originalAiOrigin;
      }
      if (originalSecret === undefined) {
        delete process.env.AI_GATEWAY_CONTEXT_SECRET;
      } else {
        process.env.AI_GATEWAY_CONTEXT_SECRET = originalSecret;
      }
    }
  });
});
