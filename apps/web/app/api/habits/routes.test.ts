import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GET, POST } from './route';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const HABIT_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '44444444-4444-4444-8444-444444444444';
const CONTEXT_SECRET = 'habit-gateway-context-secret-32-bytes';

function request(method: 'GET' | 'POST', body?: unknown): Request {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Request('https://life-os.example/api/habits', {
    method,
    headers: {
      cookie: 'life_os_session=opaque',
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { body: payload }),
  });
}

describe('Habit Next.js route handlers', () => {
  it('delegates authenticated GET and POST through the Habit BFF', async () => {
    const originalFetch = globalThis.fetch;
    const originalIdentityOrigin = process.env.IDENTITY_SERVICE_ORIGIN;
    const originalHabitOrigin = process.env.HABIT_SERVICE_ORIGIN;
    const originalContextSecret = process.env.HABIT_GATEWAY_CONTEXT_SECRET;
    const habitCalls: Array<{ method: string; path: string }> = [];
    process.env.IDENTITY_SERVICE_ORIGIN = 'http://identity-service:4101';
    process.env.HABIT_SERVICE_ORIGIN = 'http://habit-service:4103';
    process.env.HABIT_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;

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
      habitCalls.push({ method, path: url.pathname });
      const habit = {
        id: HABIT_ID,
        workspaceId: WORKSPACE_ID,
        title: 'Write one evidence note',
        timezone: 'Asia/Seoul',
        startsOn: '2026-09-01',
        recurrence: { kind: 'daily', interval: 1 },
        createdAt: '2026-09-01T02:00:00.000Z',
      };
      return method === 'POST'
        ? Response.json(habit, { status: 201 })
        : Response.json([habit]);
    };

    try {
      assert.equal((await GET(request('GET'))).status, 200);
      assert.equal(
        (
          await POST(
            request('POST', {
              title: 'Write one evidence note',
              timezone: 'Asia/Seoul',
              startsOn: '2026-09-01',
              recurrence: { kind: 'daily', interval: 1 },
            }),
          )
        ).status,
        201,
      );
      assert.deepEqual(habitCalls, [
        { method: 'GET', path: '/v1/habits' },
        { method: 'POST', path: '/v1/habits' },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalIdentityOrigin === undefined) {
        delete process.env.IDENTITY_SERVICE_ORIGIN;
      } else {
        process.env.IDENTITY_SERVICE_ORIGIN = originalIdentityOrigin;
      }
      if (originalHabitOrigin === undefined) {
        delete process.env.HABIT_SERVICE_ORIGIN;
      } else {
        process.env.HABIT_SERVICE_ORIGIN = originalHabitOrigin;
      }
      if (originalContextSecret === undefined) {
        delete process.env.HABIT_GATEWAY_CONTEXT_SECRET;
      } else {
        process.env.HABIT_GATEWAY_CONTEXT_SECRET = originalContextSecret;
      }
    }
  });
});
