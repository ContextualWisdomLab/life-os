import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { handleTodaySyncRequest } from './today-sync-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REVISION = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = '33333333-3333-4333-8333-333333333333';
const DATE = '2026-08-09';
const SECRET = 'a'.repeat(32);
const ENVIRONMENT = {
  IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
  PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
  PLANNING_GATEWAY_CONTEXT_SECRET: SECRET,
};

function aggregate(title = 'Durable Today') {
  return {
    version: 'life-os.today.v1',
    aggregateId: '44444444-4444-4444-8444-444444444444',
    revision: REVISION,
    date: DATE,
    actions: [
      {
        id: ACTION_ID,
        title,
        status: 'open',
        priority: 1,
        startMinute: 540,
        durationMinutes: 60,
        createdAt: '2026-08-09T00:00:00.000Z',
        completedAt: null,
      },
    ],
  };
}

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers });
}

describe('Today synchronization BFF', () => {
  it('authenticates the browser, derives workspace server-side, and returns bounded GET state with ETag', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/v1/session')) {
        return jsonResponse({ workspaceId: WORKSPACE_ID });
      }
      return jsonResponse(aggregate(), 200, { etag: `"${REVISION}"` });
    };
    const request = new Request(
      `https://life.example.test/api/planning/today/${DATE}`,
      { headers: { cookie: 'session=browser-secret' } },
    );

    const response = await handleTodaySyncRequest(
      request,
      DATE,
      ENVIRONMENT,
      fetcher,
      1_786_259_200,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('etag'), `"${REVISION}"`);
    assert.deepEqual(await response.json(), aggregate());
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.url, 'https://identity.example.test/v1/session');
    assert.equal(calls[0]?.init?.headers instanceof Headers, true);
    assert.equal((calls[0]?.init?.headers as Headers).get('cookie'), 'session=browser-secret');
    assert.equal(calls[1]?.url, `https://planning.example.test/v1/today/${DATE}`);
    const planningHeaders = calls[1]?.init?.headers as Headers;
    assert.equal(planningHeaders.has('cookie'), false);
    assert.equal(planningHeaders.get('x-life-os-workspace-id'), WORKSPACE_ID);
    assert.equal(planningHeaders.get('x-life-os-context-issued-at'), '1786259200');
    assert.equal(planningHeaders.get('x-life-os-context-signature')?.length, 43);
  });

  it('forwards only the complete Today document and explicit concurrency/idempotency headers on PUT', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const idempotencyKey = randomUUID();
    const draft = {
      version: 'life-os.today.v1',
      date: DATE,
      actions: aggregate().actions,
    };
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/v1/session')) {
        return jsonResponse({ workspaceId: WORKSPACE_ID });
      }
      return jsonResponse(aggregate(), 200, { etag: `"${REVISION}"` });
    };
    const request = new Request(
      `https://life.example.test/api/planning/today/${DATE}`,
      {
        method: 'PUT',
        headers: {
          cookie: 'session=browser-secret',
          'content-type': 'application/json',
          'if-match': `"${REVISION}"`,
          'idempotency-key': idempotencyKey,
          'x-workspace-id': 'attacker-selected-workspace',
        },
        body: JSON.stringify(draft),
      },
    );

    const response = await handleTodaySyncRequest(
      request,
      DATE,
      ENVIRONMENT,
      fetcher,
      1_786_259_200,
    );

    assert.equal(response.status, 200);
    const planningCall = calls[1];
    assert.equal(planningCall?.init?.method, 'PUT');
    const planningHeaders = planningCall?.init?.headers as Headers;
    assert.equal(planningHeaders.get('if-match'), `"${REVISION}"`);
    assert.equal(planningHeaders.get('idempotency-key'), idempotencyKey);
    assert.equal(planningHeaders.get('x-workspace-id'), null);
    assert.equal(planningHeaders.get('x-life-os-workspace-id'), WORKSPACE_ID);
    assert.equal(planningCall?.init?.body, JSON.stringify(draft));
  });

  it('uses If-None-Match for explicit first migration and does not silently infer overwrite authority', async () => {
    const calls: RequestInit[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init ?? {});
      if (String(input).endsWith('/v1/session')) {
        return jsonResponse({ workspaceId: WORKSPACE_ID });
      }
      return jsonResponse(aggregate(), 201, { etag: `"${REVISION}"` });
    };
    const request = new Request(
      `https://life.example.test/api/planning/today/${DATE}`,
      {
        method: 'PUT',
        headers: {
          cookie: 'session=browser-secret',
          'content-type': 'application/json',
          'if-none-match': '*',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          version: 'life-os.today.v1',
          date: DATE,
          actions: aggregate().actions,
        }),
      },
    );

    const response = await handleTodaySyncRequest(request, DATE, ENVIRONMENT, fetcher);

    assert.equal(response.status, 201);
    const planningHeaders = calls[1]?.headers as Headers;
    assert.equal(planningHeaders.get('if-none-match'), '*');
    assert.equal(planningHeaders.get('if-match'), null);
  });

  it('does not call planning when identity is unauthenticated', async () => {
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return jsonResponse({ code: 'unauthorized' }, 401);
    };
    const request = new Request(
      `https://life.example.test/api/planning/today/${DATE}`,
    );

    const response = await handleTodaySyncRequest(request, DATE, ENVIRONMENT, fetcher);

    assert.equal(response.status, 401);
    assert.equal(calls, 1);
    assert.deepEqual(await response.json(), {
      type: 'about:blank',
      title: 'Authentication is required',
      status: 401,
      code: 'authentication_required',
    });
  });

  it('passes through only bounded known revision conflicts for explicit reconciliation', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/session')) {
        return jsonResponse({ workspaceId: WORKSPACE_ID });
      }
      return jsonResponse(
        {
          type: 'about:blank',
          title: 'Today changed on another device',
          status: 409,
          code: 'today_revision_conflict',
          currentRevision: REVISION,
          injected: 'must not pass through',
        },
        409,
      );
    };
    const request = new Request(
      `https://life.example.test/api/planning/today/${DATE}`,
      {
        method: 'PUT',
        headers: {
          cookie: 'session=browser-secret',
          'content-type': 'application/json',
          'if-match': `"${REVISION}"`,
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          version: 'life-os.today.v1',
          date: DATE,
          actions: aggregate().actions,
        }),
      },
    );

    const response = await handleTodaySyncRequest(request, DATE, ENVIRONMENT, fetcher);

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      type: 'about:blank',
      title: 'Today changed on another device',
      status: 409,
      code: 'today_revision_conflict',
      currentRevision: REVISION,
    });
  });

  it('fails closed on invalid dates, browser bodies, conditional headers, or oversized upstream payloads', async () => {
    const neverFetch = async () => {
      throw new Error('fetch must not run');
    };
    const invalidDate = await handleTodaySyncRequest(
      new Request('https://life.example.test/api/planning/today/not-a-date'),
      'not-a-date',
      ENVIRONMENT,
      neverFetch,
    );
    assert.equal(invalidDate.status, 400);

    const invalidPut = await handleTodaySyncRequest(
      new Request(`https://life.example.test/api/planning/today/${DATE}`, {
        method: 'PUT',
        headers: {
          'content-type': 'text/plain',
          'if-none-match': '*',
          'idempotency-key': randomUUID(),
        },
        body: '{}',
      }),
      DATE,
      ENVIRONMENT,
      neverFetch,
    );
    assert.equal(invalidPut.status, 400);
  });
});
