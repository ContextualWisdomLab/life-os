import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  handlePlanningGoalCreateRequest,
  type PlanningGoalFetch,
} from './planning-goal-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const TITLE = 'Publish the first LifeOS release candidate';
const NOW_SECONDS = 1_788_220_800;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  PLANNING_SERVICE_ORIGIN: 'http://planning-service:4102',
  PLANNING_GATEWAY_CONTEXT_SECRET: 'planning-gateway-context-secret-32-bytes',
};

function createRequest(): Request {
  return new Request('https://life-os.example/api/planning/goals', {
    method: 'POST',
    headers: {
      cookie: 'life_os_session=opaque_session_value',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ title: TITLE }),
  });
}

function sessionResponse(): Response {
  return Response.json({
    sessionId: '33333333-3333-4333-8333-333333333333',
    userId: '44444444-4444-4444-8444-444444444444',
    workspaceId: WORKSPACE_ID,
    createdAt: '2026-09-01T01:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z',
  });
}

function goalResponse(
  overrides: Partial<
    Record<'id' | 'workspaceId' | 'title' | 'createdAt', unknown>
  >,
): Response {
  return Response.json(
    {
      id: GOAL_ID,
      workspaceId: WORKSPACE_ID,
      title: TITLE,
      createdAt: '2026-09-01T02:00:00.000Z',
      ...overrides,
    },
    { status: 201 },
  );
}

async function createThrough(planningResponse: Response): Promise<Response> {
  let calls = 0;
  const fetcher: PlanningGoalFetch = async () => {
    calls += 1;
    return calls === 1 ? sessionResponse() : planningResponse;
  };
  const response = await handlePlanningGoalCreateRequest(
    createRequest(),
    environment,
    fetcher,
    NOW_SECONDS,
  );
  assert.equal(calls, 2);
  return response;
}

describe('planning goal BFF canonical durable evidence', () => {
  it('rejects Planning UUID text that is valid but not already canonical', async () => {
    for (const planningResponse of [
      goalResponse({ id: GOAL_ID.toUpperCase() }),
      goalResponse({ workspaceId: WORKSPACE_ID.toUpperCase() }),
    ]) {
      const response = await createThrough(planningResponse);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Goal creation is unavailable',
        status: 503,
        code: 'goal_creation_unavailable',
      });
    }
  });

  it('rejects Planning timestamps that normalize to a canonical instant', async () => {
    for (const createdAt of [
      '2026-09-01T11:00:00.000+09:00',
      '2026-09-01T02:00:00Z',
      '2026-09-01T02:00:00.000000000Z',
    ]) {
      const response = await createThrough(goalResponse({ createdAt }));
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Goal creation is unavailable',
        status: 503,
        code: 'goal_creation_unavailable',
      });
    }
  });
});
