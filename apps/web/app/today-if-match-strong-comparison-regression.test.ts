import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { handleTodaySyncRequest } from './today-sync-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REVISION = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DATE = '2026-08-09';
const ENVIRONMENT = {
  IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
  PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
  PLANNING_GATEWAY_CONTEXT_SECRET: 'a'.repeat(32),
};

describe('Today If-Match strong comparison boundary', () => {
  it('preserves the browser-supplied opaque entity-tag for Planning strong comparison', async () => {
    const uppercaseTag = `\"${REVISION.toUpperCase()}\"`;
    let forwardedIfMatch: string | null | undefined;
    const request = new Request(
      `https://life.example.test/api/planning/today/${DATE}`,
      {
        method: 'PUT',
        headers: {
          cookie: 'session=opaque',
          'content-type': 'application/json',
          'if-match': uppercaseTag,
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({
          version: 'life-os.today.v1',
          date: DATE,
          actions: [],
        }),
      },
    );
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/v1/session')) {
        return Response.json({ workspaceId: WORKSPACE_ID });
      }
      forwardedIfMatch = (init?.headers as Headers).get('if-match');
      return Response.json(
        {
          type: 'about:blank',
          title: 'Today changed on another device',
          status: 409,
          code: 'today_revision_conflict',
          currentRevision: REVISION,
        },
        {
          status: 409,
          headers: { 'content-type': 'application/problem+json' },
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
    assert.equal(forwardedIfMatch, uppercaseTag);
  });
});
