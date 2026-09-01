import assert from 'node:assert/strict';
import { it } from 'node:test';
import { handlePlanningGoalCreateRequest } from './planning-goal-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const CONTEXT_SECRET = 'planning-gateway-context-secret-32-bytes';

it('accepts case-insensitive JSON media types at browser and service boundaries', async () => {
  const request = new Request('https://life-os.example/api/planning/goals', {
    method: 'POST',
    headers: {
      cookie: 'life_os_session=opaque_session_value',
      'content-type': 'Application/JSON; Charset=UTF-8',
    },
    body: JSON.stringify({ title: 'Preserve HTTP media type semantics' }),
  });
  let calls = 0;

  const response = await handlePlanningGoalCreateRequest(
    request,
    {
      IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
      PLANNING_SERVICE_ORIGIN: 'http://planning-service:4102',
      PLANNING_GATEWAY_CONTEXT_SECRET: CONTEXT_SECRET,
    },
    async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ workspaceId: WORKSPACE_ID }), {
          status: 200,
          headers: { 'content-type': 'APPLICATION/JSON' },
        });
      }
      return new Response(
        JSON.stringify({
          id: GOAL_ID,
          workspaceId: WORKSPACE_ID,
          title: 'Preserve HTTP media type semantics',
          createdAt: '2026-09-01T04:00:00.000Z',
        }),
        {
          status: 201,
          headers: { 'content-type': 'Application/Json; charset=utf-8' },
        },
      );
    },
    1_788_220_800,
  );

  assert.equal(calls, 2);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    id: GOAL_ID,
    title: 'Preserve HTTP media type semantics',
    createdAt: '2026-09-01T04:00:00.000Z',
  });
});
