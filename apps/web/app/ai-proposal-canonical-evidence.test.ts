import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handleAiProposalRequest,
  type AiProposalFetch,
  type AiProposalRoute,
} from './ai-proposal-client';

const WORKSPACE_ID = 'a1111111-b111-4111-8111-c11111111111';
const ACTOR_ID = 'd2222222-e222-4222-8222-a22222222222';
const SESSION_ID = 'b3333333-c333-4333-8333-d33333333333';
const PROPOSAL_ID = 'c4444444-d444-4444-8444-e44444444444';
const TASK_ID = 'd5555555-e555-4555-8555-a55555555555';
const DECISION_ID = 'e6666666-a666-4666-8666-b66666666666';
const IDEMPOTENCY_KEY = 'a7777777-b777-4777-8777-c77777777777';
const CONTENT_DIGEST = 'b'.repeat(64);
const NOW_SECONDS = 1_785_806_400;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  AI_SERVICE_ORIGIN: 'http://ai-service:4105',
  AI_GATEWAY_ACTIVE_KEY_ID: 'gateway-2026-09-a',
  AI_GATEWAY_ACTIVE_KEY_SECRET: 'web-ai-proposal-canonical-evidence-secret',
};

const proposalRequest = {
  objective: 'Preserve canonical producer evidence',
  context: [
    {
      id: TASK_ID,
      kind: 'task',
      title: 'Verify producer evidence without rewriting it',
      status: 'active',
    },
  ],
} as const;

function jsonResponse(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function sessionResponse(
  workspaceId = WORKSPACE_ID,
  actorId = ACTOR_ID,
): Response {
  return jsonResponse({
    sessionId: SESSION_ID,
    userId: actorId,
    workspaceId,
    createdAt: '2026-08-04T10:00:00.000Z',
    expiresAt: '2026-08-05T10:00:00.000Z',
  });
}

function proposal(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    proposalId: PROPOSAL_ID,
    workspaceId: WORKSPACE_ID,
    summary: 'Keep service-owned evidence byte-stable.',
    rationale: ['The BFF must validate producer representation before reuse.'],
    operations: [
      {
        kind: 'prioritize_item',
        targetId: TASK_ID,
        description: 'Preserve the producer-owned target identity.',
      },
    ],
    requiresConfirmation: true,
    createdAt: '2026-08-04T11:00:00.000Z',
    ...overrides,
  };
}

function auditRecord(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    proposal: proposal(),
    request: proposalRequest,
    modelId: 'rule-based-v1',
    requestDigest: 'a'.repeat(64),
    contentDigest: CONTENT_DIGEST,
    recordedAt: '2026-08-04T11:00:01.000Z',
    ...overrides,
  };
}

function decisionEvent(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: DECISION_ID,
    workspaceId: WORKSPACE_ID,
    proposalId: PROPOSAL_ID,
    proposalContentDigest: CONTENT_DIGEST,
    actorId: ACTOR_ID,
    decision: 'accepted',
    reason: 'Reviewed without executing the proposal.',
    idempotencyKey: IDEMPOTENCY_KEY,
    decidedAt: '2026-08-04T11:00:02.000Z',
    recordedAt: '2026-08-04T11:00:03.000Z',
    ...overrides,
  };
}

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

async function requestWithProducerEvidence(
  request: Request,
  route: AiProposalRoute,
  representation: unknown,
  aiStatus: 200 | 201,
  workspaceId = WORKSPACE_ID,
  actorId = ACTOR_ID,
): Promise<{ response: Response; calls: number }> {
  let calls = 0;
  const fetcher: AiProposalFetch = async () => {
    calls += 1;
    return calls === 1
      ? sessionResponse(workspaceId, actorId)
      : jsonResponse(representation, aiStatus);
  };
  const response = await handleAiProposalRequest(
    request,
    environment,
    route,
    fetcher,
    NOW_SECONDS,
  );
  return { response, calls };
}

async function expectUnavailable(
  result: Promise<{ response: Response }>,
): Promise<void> {
  const { response } = await result;
  assert.equal(response.status, 503);
  assert.equal(
    ((await response.json()) as { code?: string }).code,
    'ai_proposal_unavailable',
  );
}

describe('AI proposal producer evidence canonicality', () => {
  it('rejects case-aliased Identity principal evidence before deriving AI authority', async () => {
    const result = await requestWithProducerEvidence(
      browserRequest('POST', '/api/ai/proposals', proposalRequest),
      { kind: 'collection' },
      proposal(),
      201,
      WORKSPACE_ID.toUpperCase(),
      ACTOR_ID.toUpperCase(),
    );

    assert.equal(result.response.status, 503);
    assert.equal(result.calls, 1);
  });

  it('rejects byte-different proposal evidence instead of recanonicalizing it', async () => {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      [
        'proposal id casing',
        proposal({ proposalId: PROPOSAL_ID.toUpperCase() }),
      ],
      [
        'workspace id casing',
        proposal({ workspaceId: WORKSPACE_ID.toUpperCase() }),
      ],
      [
        'operation target casing',
        proposal({
          operations: [
            {
              kind: 'prioritize_item',
              targetId: TASK_ID.toUpperCase(),
              description: 'Preserve the producer-owned target identity.',
            },
          ],
        }),
      ],
      [
        'timestamp representation',
        proposal({ createdAt: '2026-08-04T12:00:00.000+01:00' }),
      ],
    ];

    for (const [name, representation] of cases) {
      await expectUnavailable(
        requestWithProducerEvidence(
          browserRequest('POST', '/api/ai/proposals', proposalRequest),
          { kind: 'collection' },
          representation,
          201,
        ),
      ).catch((error: unknown) => {
        throw new Error(`${name}: ${String(error)}`);
      });
    }
  });

  it('rejects byte-different immutable audit timestamps', async () => {
    await expectUnavailable(
      requestWithProducerEvidence(
        browserRequest('GET', `/api/ai/proposals/${PROPOSAL_ID}`),
        { kind: 'proposal', proposalId: PROPOSAL_ID },
        auditRecord({ recordedAt: '2026-08-04T12:00:01.000+01:00' }),
        200,
      ),
    );
  });

  it('rejects byte-different decision evidence instead of recanonicalizing it', async () => {
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
      ['decision id casing', decisionEvent({ id: DECISION_ID.toUpperCase() })],
      [
        'workspace id casing',
        decisionEvent({ workspaceId: WORKSPACE_ID.toUpperCase() }),
      ],
      [
        'proposal id casing',
        decisionEvent({ proposalId: PROPOSAL_ID.toUpperCase() }),
      ],
      ['actor id casing', decisionEvent({ actorId: ACTOR_ID.toUpperCase() })],
      [
        'idempotency key casing',
        decisionEvent({ idempotencyKey: IDEMPOTENCY_KEY.toUpperCase() }),
      ],
      [
        'decision timestamp representation',
        decisionEvent({ decidedAt: '2026-08-04T12:00:02.000+01:00' }),
      ],
      [
        'recorded timestamp representation',
        decisionEvent({ recordedAt: '2026-08-04T12:00:03.000+01:00' }),
      ],
    ];

    for (const [name, representation] of cases) {
      await expectUnavailable(
        requestWithProducerEvidence(
          browserRequest('POST', `/api/ai/proposals/${PROPOSAL_ID}/decisions`, {
            expectedContentDigest: CONTENT_DIGEST,
            idempotencyKey: IDEMPOTENCY_KEY,
            decision: 'accepted',
            reason: 'Reviewed without executing the proposal.',
            decidedAt: '2026-08-04T11:00:02.000Z',
          }),
          { kind: 'decisions', proposalId: PROPOSAL_ID },
          representation,
          201,
        ),
      ).catch((error: unknown) => {
        throw new Error(`${name}: ${String(error)}`);
      });
    }
  });
});
