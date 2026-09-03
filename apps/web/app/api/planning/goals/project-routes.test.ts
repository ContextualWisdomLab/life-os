import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET, POST } from './[goalId]/projects/route';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '55555555-5555-4555-8555-555555555555';
const CONTEXT_SECRET = 'planning-gateway-context-secret-32-bytes';

function request(method: 'GET' | 'POST', body?: unknown): Request {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Request(
    `https://life-os.example/api/planning/goals/${GOAL_ID}/projects`,
    {
      method,
      headers: {
        cookie: 'life_os_session=opaque',
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { body: payload }),
    },
  );
}

describe('Planning Project Next.js route handlers', () => {
  it('awaits the dynamic Goal identifier and delegates GET and POST to the authenticated BFF', async () => {
    const originalFetch = globalThis.fetch;
    const originalIdentityOrigin = process.env.IDENTITY_SERVICE_ORIGIN;
    const originalPlanningOrigin = process.env.PLANNING_SERVICE_ORIGIN;
    const originalContextSecret = process.env.PLANNING_GATEWAY_CONTEXT_SECRET;
    const planningCalls: Array<{ method: string; path: string }> = [];
    process.env.IDENTITY_SERVICE_ORIGIN = 'http://identity-service:4101';
    process.env.PLANNING_SERVICE_ORIGIN = 'http://planning-service:4102';
    process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;

    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1/session') {
        return Response.json({
          sessionId: SESSION_ID,
          userId: USER_ID,
          workspaceId: WORKSPACE_ID,
          createdAt: '2026-09-01T01:00:00.000Z',
          expiresAt: '2026-09-02T01:00:00.000Z',
        });
      }
      const method = init?.method ?? 'GET';
      planningCalls.push({ method, path: url.pathname });
      const project = {
        id: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        goalId: GOAL_ID,
        title: 'Wire the Project browser boundary',
        createdAt: '2026-09-01T02:00:00.000Z',
      };
      return method === 'POST'
        ? Response.json(project, { status: 201 })
        : Response.json([project]);
    };

    try {
      assert.equal(
        (
          await GET(request('GET'), {
            params: Promise.resolve({ goalId: GOAL_ID }),
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await POST(
            request('POST', { title: 'Wire the Project browser boundary' }),
            { params: Promise.resolve({ goalId: GOAL_ID }) },
          )
        ).status,
        201,
      );
      assert.deepEqual(planningCalls, [
        { method: 'GET', path: `/v1/goals/${GOAL_ID}/projects` },
        { method: 'POST', path: `/v1/goals/${GOAL_ID}/projects` },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalIdentityOrigin === undefined) {
        delete process.env.IDENTITY_SERVICE_ORIGIN;
      } else {
        process.env.IDENTITY_SERVICE_ORIGIN = originalIdentityOrigin;
      }
      if (originalPlanningOrigin === undefined) {
        delete process.env.PLANNING_SERVICE_ORIGIN;
      } else {
        process.env.PLANNING_SERVICE_ORIGIN = originalPlanningOrigin;
      }
      if (originalContextSecret === undefined) {
        delete process.env.PLANNING_GATEWAY_CONTEXT_SECRET;
      } else {
        process.env.PLANNING_GATEWAY_CONTEXT_SECRET = originalContextSecret;
      }
    }
  });
});
