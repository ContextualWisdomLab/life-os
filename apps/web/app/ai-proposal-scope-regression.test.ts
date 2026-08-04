import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleAiProposalRequest,
  type AiProposalFetch,
  type AiProposalRoute,
} from './ai-proposal-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const PROPOSAL_ID = '66666666-6666-4666-8666-666666666666';
const TASK_ID = '77777777-7777-4777-8777-777777777777';
const DECISION_ID = '88888888-8888-4888-8888-888888888888';
const IDEMPOTENCY_KEY = '99999999-9999-4999-8999-999999999999';
const ACTIVE_KEY_ID = 'gateway-2026-08-a';
const SECRET = 'authenticated-ai-scope-regression-secret';
const NOW_SECONDS = 1_785_806_400;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  AI_SERVICE_ORIGIN: 'http://ai-service:4105',
  AI_GATEWAY_ACTIVE_KEY_ID: ACTIVE_KEY_ID,
  AI_GATEWAY_ACTIVE_KEY_SECRET: SECRET,
};

/** Creates one bounded JSON response for deterministic dependency simulation. */
function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/** Returns the authenticated identity principal used by every regression case. */
function sessionResponse(): Response {
  return jsonResponse({
    sessionId: SESSION_ID,
    userId: ACTOR_ID,
    workspaceId: WORKSPACE_ID,
    createdAt: '2026-08-04T10:00:00.000Z',
    expiresAt: '2026-08-05T10:00:00.000Z',
  });
}

/** Creates one canonical inert proposal for a selected workspace. */
function proposal(workspaceId: string): Record<string, unknown> {
  return {
    proposalId: PROPOSAL_ID,
    workspaceId,
    summary: 'Review authenticated AI scope.',
    rationale: ['The proposal remains inert until explicitly confirmed.'],
    operations: [
      {
        kind: 'prioritize_item',
        targetId: TASK_ID,
        description: 'Prioritize the authenticated AI scope review.',
      },
    ],
    requiresConfirmation: true,
    createdAt: '2026-08-04T11:00:00.000Z',
  };
}

/** Creates one immutable audit record for a selected workspace. */
function auditRecord(workspaceId: string): Record<string, unknown> {
  return {
    proposal: proposal(workspaceId),
    request: {
      objective: 'Review authenticated AI scope',
      context: [
        {
          id: TASK_ID,
          kind: 'task',
          title: 'Review authenticated AI scope',
          status: 'active',
        },
      ],
    },
    modelId: 'rule-based-v1',
    requestDigest: 'a'.repeat(64),
    contentDigest: 'b'.repeat(64),
    recordedAt: '2026-08-04T11:00:01.000Z',
  };
}

/** Creates one append-only decision event for selected tenant and actor scope. */
function decisionEvent(
  workspaceId: string,
  actorId: string,
): Record<string, unknown> {
  return {
    id: DECISION_ID,
    workspaceId,
    proposalId: PROPOSAL_ID,
    proposalContentDigest: 'b'.repeat(64),
    actorId,
    decision: 'accepted',
    reason: 'Reviewed without executing the proposal.',
    idempotencyKey: IDEMPOTENCY_KEY,
    decidedAt: '2026-08-04T11:00:02.000Z',
    recordedAt: '2026-08-04T11:00:03.000Z',
  };
}

/** Creates a same-origin request with the opaque browser session cookie. */
function browserRequest(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Request {
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

/** Runs one request against identity followed by the supplied AI representation. */
async function requestWithAiRepresentation(
  request: Request,
  route: AiProposalRoute,
  representation: unknown,
  aiStatus: 200 | 201,
): Promise<Response> {
  let calls = 0;
  const fetcher: AiProposalFetch = async () => {
    calls += 1;
    return calls === 1
      ? sessionResponse()
      : jsonResponse(representation, aiStatus);
  };
  return await handleAiProposalRequest(
    request,
    environment,
    route,
    fetcher,
    NOW_SECONDS,
  );
}

describe('authenticated AI upstream scope validation', () => {
  it('rejects a generated proposal whose workspace differs from the identity session', async () => {
    const response = await requestWithAiRepresentation(
      browserRequest('POST', '/api/ai/proposals', {
        objective: 'Review authenticated AI scope',
        context: [
          {
            id: TASK_ID,
            kind: 'task',
            title: 'Review authenticated AI scope',
            status: 'active',
          },
        ],
      }),
      { kind: 'collection' },
      proposal(OTHER_WORKSPACE_ID),
      201,
    );

    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      'ai_proposal_unavailable',
    );
  });

  it('rejects persisted proposal evidence from another workspace', async () => {
    const response = await requestWithAiRepresentation(
      browserRequest('GET', `/api/ai/proposals/${PROPOSAL_ID}`),
      { kind: 'proposal', proposalId: PROPOSAL_ID },
      auditRecord(OTHER_WORKSPACE_ID),
      200,
    );

    assert.equal(response.status, 503);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      'ai_proposal_unavailable',
    );
  });

  it('rejects a decision event whose workspace or actor differs from the identity session', async () => {
    for (const event of [
      decisionEvent(OTHER_WORKSPACE_ID, ACTOR_ID),
      decisionEvent(WORKSPACE_ID, OTHER_ACTOR_ID),
    ]) {
      const response = await requestWithAiRepresentation(
        browserRequest('POST', `/api/ai/proposals/${PROPOSAL_ID}/decisions`, {
          expectedContentDigest: 'b'.repeat(64),
          idempotencyKey: IDEMPOTENCY_KEY,
          decision: 'accepted',
          reason: 'Reviewed without executing the proposal.',
          decidedAt: '2026-08-04T11:00:02.000Z',
        }),
        { kind: 'decisions', proposalId: PROPOSAL_ID },
        event,
        201,
      );

      assert.equal(response.status, 503);
      assert.equal(
        ((await response.json()) as { code: string }).code,
        'ai_proposal_unavailable',
      );
    }
  });
});
