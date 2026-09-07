import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import {
  handleHabitCreateRequest,
  handleHabitListRequest,
  type HabitFetch,
} from './habit-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const HABIT_ID = '22222222-2222-4222-8222-222222222222';
const SECOND_HABIT_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const CONTEXT_SECRET = 'habit-gateway-context-secret-32-bytes';
const NOW_SECONDS = 1_788_220_800;

const environment = {
  IDENTITY_SERVICE_ORIGIN: 'http://identity-service:4101',
  HABIT_SERVICE_ORIGIN: 'http://habit-service:4103',
  HABIT_GATEWAY_CONTEXT_SECRET: CONTEXT_SECRET,
};

function sessionResponse(status = 200): Response {
  return Response.json(
    {
      sessionId: SESSION_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      createdAt: '2026-09-01T01:00:00.000Z',
      expiresAt: '2026-09-02T01:00:00.000Z',
    },
    { status },
  );
}

function habitRecord(
  overrides: Partial<
    Record<
      'id' | 'workspaceId' | 'title' | 'timezone' | 'startsOn' | 'recurrence' | 'createdAt',
      unknown
    >
  > = {},
): Record<string, unknown> {
  return {
    id: HABIT_ID,
    workspaceId: WORKSPACE_ID,
    title: 'Write one evidence note',
    timezone: 'Asia/Seoul',
    startsOn: '2026-09-01',
    recurrence: { kind: 'daily', interval: 1 },
    createdAt: '2026-09-01T02:00:00.000Z',
    ...overrides,
  };
}

function createRequest(body: unknown): Request {
  return new Request('https://life-os.example/api/habits', {
    method: 'POST',
    headers: {
      cookie: 'life_os_session=opaque_session_value',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function listRequest(): Request {
  return new Request('https://life-os.example/api/habits', {
    method: 'GET',
    headers: { cookie: 'life_os_session=opaque_session_value' },
  });
}

describe('authenticated Habit create BFF', () => {
  it('derives workspace authority from Identity and never forwards browser credentials', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetcher: HabitFetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return calls.length === 1
        ? sessionResponse()
        : Response.json(habitRecord(), { status: 201 });
    };

    const response = await handleHabitCreateRequest(
      createRequest({
        title: 'Write one evidence note',
        timezone: 'Asia/Seoul',
        startsOn: '2026-09-01',
        recurrence: { kind: 'daily', interval: 1 },
      }),
      environment,
      fetcher,
      NOW_SECONDS,
    );

    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      id: HABIT_ID,
      title: 'Write one evidence note',
      timezone: 'Asia/Seoul',
      startsOn: '2026-09-01',
      recurrence: { kind: 'daily', interval: 1 },
      createdAt: '2026-09-01T02:00:00.000Z',
    });

    assert.equal(calls[0]?.url, 'http://identity-service:4101/v1/session');
    assert.equal(
      new Headers(calls[0]?.init?.headers).get('cookie'),
      'life_os_session=opaque_session_value',
    );
    assert.equal(calls[1]?.url, 'http://habit-service:4103/v1/habits');
    assert.equal(calls[1]?.init?.method, 'POST');
    assert.equal(
      calls[1]?.init?.body,
      JSON.stringify({
        title: 'Write one evidence note',
        timezone: 'Asia/Seoul',
        startsOn: '2026-09-01',
        recurrence: { kind: 'daily', interval: 1 },
      }),
    );

    const headers = new Headers(calls[1]?.init?.headers);
    assert.equal(headers.get('x-life-os-workspace-id'), WORKSPACE_ID);
    assert.equal(headers.get('x-life-os-context-issued-at'), String(NOW_SECONDS));
    assert.equal(
      headers.get('x-life-os-context-signature'),
      createHmac('sha256', CONTEXT_SECRET)
        .update(`life-os.workspace.v1\n${WORKSPACE_ID}\n${NOW_SECONDS}`, 'utf8')
        .digest('base64url'),
    );
    assert.equal(headers.get('cookie'), null);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(calls[0]?.init?.redirect, 'error');
    assert.equal(calls[1]?.init?.redirect, 'error');
  });

  it('rejects malformed or authority-bearing bodies before dependency access', async () => {
    const invalidBodies = [
      null,
      [],
      {},
      { title: '', timezone: 'Asia/Seoul', startsOn: '2026-09-01', recurrence: { kind: 'daily', interval: 1 } },
      { title: 'Habit', workspaceId: WORKSPACE_ID, timezone: 'Asia/Seoul', startsOn: '2026-09-01', recurrence: { kind: 'daily', interval: 1 } },
      { title: 'Habit', timezone: 'Not/AZone', startsOn: '2026-09-01', recurrence: { kind: 'daily', interval: 1 } },
      { title: 'Habit', timezone: 'Asia/Seoul', startsOn: '2026-02-30', recurrence: { kind: 'daily', interval: 1 } },
      { title: 'Habit', timezone: 'Asia/Seoul', startsOn: '2026-09-01', recurrence: { kind: 'weekly', interval: 1, weekdays: [] } },
    ];

    for (const body of invalidBodies) {
      let called = false;
      const response = await handleHabitCreateRequest(
        createRequest(body),
        environment,
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
        title: 'Habit request is invalid',
        status: 400,
        code: 'invalid_habit_request',
      });
    }
  });

  it('fails closed on unauthenticated identity and malformed Habit ownership evidence', async () => {
    let calls = 0;
    const unauthenticated = await handleHabitCreateRequest(
      createRequest({
        title: 'Habit',
        timezone: 'Asia/Seoul',
        startsOn: '2026-09-01',
        recurrence: { kind: 'daily', interval: 1 },
      }),
      environment,
      async () => {
        calls += 1;
        return sessionResponse(401);
      },
      NOW_SECONDS,
    );
    assert.equal(unauthenticated.status, 401);
    assert.equal(calls, 1);

    calls = 0;
    const malformed = await handleHabitCreateRequest(
      createRequest({
        title: 'Habit',
        timezone: 'Asia/Seoul',
        startsOn: '2026-09-01',
        recurrence: { kind: 'daily', interval: 1 },
      }),
      environment,
      async () => {
        calls += 1;
        return calls === 1
          ? sessionResponse()
          : Response.json(
              habitRecord({ workspaceId: SECOND_HABIT_ID, title: 'Habit' }),
              { status: 201 },
            );
      },
      NOW_SECONDS,
    );
    assert.equal(malformed.status, 503);
    assert.equal(calls, 2);
  });
});

describe('authenticated Habit list BFF', () => {
  it('returns only bounded browser-safe Habit records', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const response = await handleHabitListRequest(
      listRequest(),
      environment,
      async (input, init) => {
        calls.push({ url: String(input), init });
        return calls.length === 1
          ? sessionResponse()
          : Response.json([
              habitRecord(),
              habitRecord({
                id: SECOND_HABIT_ID,
                title: 'Review weekly priorities',
                recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 5] },
              }),
            ]);
      },
      NOW_SECONDS,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), [
      {
        id: HABIT_ID,
        title: 'Write one evidence note',
        timezone: 'Asia/Seoul',
        startsOn: '2026-09-01',
        recurrence: { kind: 'daily', interval: 1 },
        createdAt: '2026-09-01T02:00:00.000Z',
      },
      {
        id: SECOND_HABIT_ID,
        title: 'Review weekly priorities',
        timezone: 'Asia/Seoul',
        startsOn: '2026-09-01',
        recurrence: { kind: 'weekly', interval: 1, weekdays: [1, 5] },
        createdAt: '2026-09-01T02:00:00.000Z',
      },
    ]);
    assert.equal(calls[1]?.url, 'http://habit-service:4103/v1/habits');
    assert.equal(calls[1]?.init?.method, 'GET');
    assert.equal(new Headers(calls[1]?.init?.headers).get('cookie'), null);
  });

  it('rejects cross-workspace, duplicate, oversized, and malformed collections', async () => {
    const invalidCollections = [
      [habitRecord({ workspaceId: SECOND_HABIT_ID })],
      [habitRecord(), habitRecord()],
      Array.from({ length: 101 }, (_, index) =>
        habitRecord({
          id: `${String(index).padStart(8, 'a')}-1111-4111-8111-111111111111`,
        }),
      ),
      { habits: [] },
    ];

    for (const collection of invalidCollections) {
      let calls = 0;
      const response = await handleHabitListRequest(
        listRequest(),
        environment,
        async () => {
          calls += 1;
          return calls === 1 ? sessionResponse() : Response.json(collection);
        },
        NOW_SECONDS,
      );
      assert.equal(response.status, 503);
      assert.equal(calls, 2);
      assert.deepEqual(await response.json(), {
        type: 'about:blank',
        title: 'Habit listing is unavailable',
        status: 503,
        code: 'habit_listing_unavailable',
      });
    }
  });
});
