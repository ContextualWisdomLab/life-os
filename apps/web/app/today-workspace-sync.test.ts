import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmptyTodayDraft, addTodayAction } from './today-state';
import {
  fetchWorkspaceToday,
  saveWorkspaceToday,
  toDurableTodayDocument,
} from './today-workspace-sync';

const DATE = '2026-08-09';
const ACTION_ID = '33333333-3333-4333-8333-333333333333';
const REVISION = '22222222-2222-4222-8222-222222222222';

function draft() {
  return addTodayAction(createEmptyTodayDraft(DATE), {
    id: ACTION_ID,
    title: 'Move this only when I ask',
    createdAt: '2026-08-09T00:00:00.000Z',
  });
}

function aggregate() {
  return {
    ...toDurableTodayDocument(draft()),
    aggregateId: '44444444-4444-4444-8444-444444444444',
    revision: REVISION,
  };
}

describe('browser Today workspace synchronization', () => {
  it('converts a validated local draft without a workspace identifier', () => {
    assert.deepEqual(toDurableTodayDocument(draft()), {
      version: 'life-os.today.v1',
      date: DATE,
      actions: draft().actions,
    });
  });

  it('checks durable state only when explicitly called and converts it back to local state', async () => {
    const calls: Array<{ input: string; init?: RequestInit }> = [];
    const result = await fetchWorkspaceToday(DATE, async (input, init) => {
      calls.push({ input: String(input), init });
      return Response.json(aggregate(), {
        status: 200,
        headers: { etag: `"${REVISION}"` },
      });
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, `/api/planning/today/${DATE}`);
    assert.equal(calls[0]?.init?.method, 'GET');
    assert.equal(result.kind, 'found');
    if (result.kind === 'found') {
      assert.deepEqual(result.draft, draft());
      assert.equal(result.revision, REVISION);
    }
  });

  it('creates durable state only through an explicit save using If-None-Match and a fresh idempotency key', async () => {
    let captured: RequestInit | undefined;
    const result = await saveWorkspaceToday(
      draft(),
      null,
      async (_input, init) => {
        captured = init;
        return Response.json(aggregate(), {
          status: 201,
          headers: { etag: `"${REVISION}"` },
        });
      },
    );

    assert.equal(result.kind, 'saved');
    const headers = captured?.headers as Headers;
    assert.equal(headers.get('if-none-match'), '*');
    assert.equal(headers.get('if-match'), null);
    assert.match(
      headers.get('idempotency-key') ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.equal(captured?.body, JSON.stringify(toDurableTodayDocument(draft())));
  });

  it('updates only against the last explicitly observed strong revision', async () => {
    let captured: RequestInit | undefined;
    await saveWorkspaceToday(draft(), REVISION, async (_input, init) => {
      captured = init;
      return Response.json(aggregate(), {
        status: 200,
        headers: { etag: `"${REVISION}"` },
      });
    });

    const headers = captured?.headers as Headers;
    assert.equal(headers.get('if-match'), `"${REVISION}"`);
    assert.equal(headers.get('if-none-match'), null);
  });

  it('reports authentication, absence, conflict, and dependency failure as explicit states', async () => {
    assert.deepEqual(
      await fetchWorkspaceToday(DATE, async () =>
        Response.json({}, { status: 401 }),
      ),
      { kind: 'unauthenticated' },
    );
    assert.deepEqual(
      await fetchWorkspaceToday(DATE, async () =>
        Response.json({}, { status: 404 }),
      ),
      { kind: 'missing' },
    );
    assert.deepEqual(
      await saveWorkspaceToday(draft(), REVISION, async () =>
        Response.json(
          {
            type: 'about:blank',
            title: 'Today changed on another device',
            status: 409,
            code: 'today_revision_conflict',
            currentRevision: '55555555-5555-4555-8555-555555555555',
          },
          { status: 409 },
        ),
      ),
      {
        kind: 'conflict',
        currentRevision: '55555555-5555-4555-8555-555555555555',
      },
    );
    assert.deepEqual(
      await fetchWorkspaceToday(DATE, async () =>
        Response.json({}, { status: 503 }),
      ),
      { kind: 'unavailable' },
    );
  });

  it('fails closed on malformed durable response content instead of overwriting the local draft', async () => {
    const result = await fetchWorkspaceToday(DATE, async () =>
      Response.json(
        { ...aggregate(), actions: [{ id: 'attacker-data' }] },
        { status: 200, headers: { etag: `"${REVISION}"` } },
      ),
    );
    assert.deepEqual(result, { kind: 'unavailable' });
  });
});
