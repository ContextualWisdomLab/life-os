import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  handlePlanningProjectCreateRequest,
  type PlanningGoalFetch,
} from './planning-goal-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CONTEXT_SECRET = 'planning-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_788_220_800;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  PLANNING_SERVICE_ORIGIN: 'http://planning-service:4102',
  PLANNING_GATEWAY_CONTEXT_SECRET: CONTEXT_SECRET,
};

/** Returns one bounded authenticated Identity session fixture. */
function sessionResponse(): Response {
  return Response.json({
    sessionId: '66666666-6666-4666-8666-666666666666',
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    createdAt: '2026-09-01T01:00:00.000Z',
    expiresAt: '2026-09-02T01:00:00.000Z',
  });
}

it('preserves tenant-safe missing parent semantics without reflecting the Planning problem body', async () => {
  let calls = 0;
  const fetcher: PlanningGoalFetch = async () => {
    calls += 1;
    if (calls === 1) return sessionResponse();
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'private upstream detail must not escape',
        status: 404,
        code: 'not_found',
        secret: 'untrusted-upstream-body',
      }),
      {
        status: 404,
        headers: { 'content-type': 'application/problem+json' },
      },
    );
  };

  const response = await handlePlanningProjectCreateRequest(
    new Request(
      `https://life-os.example/api/planning/goals/${GOAL_ID}/projects`,
      {
        method: 'POST',
        headers: {
          cookie: 'life_os_session=opaque_session_value',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ title: 'Create the project safely' }),
      },
    ),
    GOAL_ID,
    environment,
    fetcher,
    NOW_SECONDS,
  );

  assert.equal(calls, 2);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    type: 'about:blank',
    title: 'Goal was not found',
    status: 404,
    code: 'goal_not_found',
  });
});
