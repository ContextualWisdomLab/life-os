import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { handleTodaySyncRequest } from './today-sync-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REVISION = '22222222-2222-4222-8222-222222222222';
const DATE = '2026-08-09';
const ENVIRONMENT = {
  IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
  PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
  PLANNING_GATEWAY_CONTEXT_SECRET: 'a'.repeat(32),
};

function identityResponse(): Response {
  return Response.json({ workspaceId: WORKSPACE_ID });
}

function aggregate() {
  return {
    version: 'life-os.today.v1',
    aggregateId: '44444444-4444-4444-8444-444444444444',
    revision: REVISION,
    date: DATE,
    actions: [],
  };
}

describe('Today synchronization review regressions', () => {
  it('accepts case-insensitive JSON media types at both browser and provider boundaries', async () => {
    const request = new Request(
      `https://life.example.test/api/planning/today/${DATE}`,
      {
        method: 'PUT',
        headers: {
          cookie: 'session=opaque',
          'content-type': 'Application/JSON; Charset=UTF-8',
          'if-none-match': '*',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          version: 'life-os.today.v1',
          date: DATE,
          actions: [],
        }),
      },
    );
    const fetcher = async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/session')) return identityResponse();
      return new Response(JSON.stringify(aggregate()), {
        status: 201,
        headers: {
          'content-type': 'Application/JSON; Charset=UTF-8',
          etag: `\"${REVISION}\"`,
        },
      });
    };

    const response = await handleTodaySyncRequest(
      request,
      DATE,
      ENVIRONMENT,
      fetcher,
    );

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), aggregate());
  });

  it('recognizes revision conflicts by stable machine fields even when the human title changes', async () => {
    const request = new Request(
      `https://life.example.test/api/planning/today/${DATE}`,
      {
        method: 'PUT',
        headers: {
          cookie: 'session=opaque',
          'content-type': 'application/json',
          'if-match': `\"${REVISION}\"`,
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          version: 'life-os.today.v1',
          date: DATE,
          actions: [],
        }),
      },
    );
    const fetcher = async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/session')) return identityResponse();
      return new Response(
        JSON.stringify({
          type: 'about:blank',
          title: 'The durable Today changed while you were editing',
          status: 409,
          code: 'today_revision_conflict',
          currentRevision: REVISION,
        }),
        {
          status: 409,
          headers: {
            'content-type': 'Application/Problem+JSON; Charset=UTF-8',
          },
        },
      );
    };

    const response = await handleTodaySyncRequest(
      request,
      DATE,
      ENVIRONMENT,
      fetcher,
    );

    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      type: 'about:blank',
      title: 'Today changed on another device',
      status: 409,
      code: 'today_revision_conflict',
      currentRevision: REVISION,
    });
  });
});
