import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleAiProposalRequest,
  type AiProposalFetch,
} from './ai-proposal-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444';
const TASK_ID = '55555555-5555-4555-8555-555555555555';
const ACTIVE_KEY_ID = 'gateway-2026-08-a';
const GATEWAY_SECRET = 'trusted-ai-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_785_806_400;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  AI_SERVICE_ORIGIN: 'http://ai-service:4105',
  AI_GATEWAY_ACTIVE_KEY_ID: ACTIVE_KEY_ID,
  AI_GATEWAY_ACTIVE_KEY_SECRET: GATEWAY_SECRET,
};

/** Creates one bounded JSON response for deterministic dependency simulation. */
function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

/** Creates one same-origin proposal request with an opaque session cookie. */
function proposalRequest(): Request {
  return new Request('https://life-os.example/api/ai/proposals', {
    method: 'POST',
    headers: {
      cookie: 'life_os_session=opaque',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      objective: 'Verify bounded identity response handling',
      context: [
        {
          id: TASK_ID,
          kind: 'task',
          title: 'Review identity stream handling',
          status: 'active',
        },
      ],
    }),
  });
}

/** Creates one valid inert proposal response in the authenticated workspace. */
function proposalResponse(): Response {
  return jsonResponse(
    {
      proposalId: PROPOSAL_ID,
      workspaceId: WORKSPACE_ID,
      summary: 'Review bounded identity response handling.',
      rationale: ['The request remains inert pending explicit confirmation.'],
      operations: [
        {
          kind: 'prioritize_item',
          targetId: TASK_ID,
          description: 'Prioritize the identity stream regression review.',
        },
      ],
      requiresConfirmation: true,
      createdAt: '2026-08-04T11:00:00.000Z',
    },
    201,
  );
}

describe('AI identity response stream regression', () => {
  it('reads and bounds the identity response without cloning an untrusted stream', async () => {
    const identityResponse = jsonResponse({
      sessionId: SESSION_ID,
      userId: ACTOR_ID,
      workspaceId: WORKSPACE_ID,
      createdAt: '2026-08-04T10:00:00.000Z',
      expiresAt: '2026-08-05T10:00:00.000Z',
    });
    Object.defineProperty(identityResponse, 'clone', {
      configurable: true,
      value: () => {
        throw new Error('Untrusted identity response must not be cloned');
      },
    });

    let calls = 0;
    const fetcher: AiProposalFetch = async () => {
      calls += 1;
      return calls === 1 ? identityResponse : proposalResponse();
    };

    const response = await handleAiProposalRequest(
      proposalRequest(),
      environment,
      { kind: 'collection' },
      fetcher,
      NOW_SECONDS,
    );

    assert.equal(calls, 2);
    assert.equal(response.status, 201);
    assert.equal(
      ((await response.json()) as { workspaceId: string }).workspaceId,
      WORKSPACE_ID,
    );
  });
});
