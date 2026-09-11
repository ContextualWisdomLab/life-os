import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GitHubApiClient } from './github-client.mjs';

function jsonResponse(value, status) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
  });
}

describe('GitHubApiClient transient read retry', () => {
  it('retries only bounded transient GET failures and returns the first successful response', async () => {
    const statuses = [504, 502, 200];
    const calls = [];
    const client = new GitHubApiClient({
      token: 'token',
      fetchImpl: async (_url, options) => {
        calls.push(options.method);
        const status = statuses.shift();
        return jsonResponse(
          status === 200 ? { ok: true } : { message: 'must-not-escape' },
          status,
        );
      },
    });

    assert.deepEqual(await client.requestJson('/repos/o/r'), { ok: true });
    assert.deepEqual(calls, ['GET', 'GET', 'GET']);
  });

  it('stops after three transient GET attempts and preserves the generic status boundary', async () => {
    let calls = 0;
    const client = new GitHubApiClient({
      token: 'token',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ secret: 'must-not-escape' }, 503);
      },
    });

    await assert.rejects(
      () => client.requestJson('/repos/o/r/actions/runs'),
      new Error('GitHub API request failed with status 503'),
    );
    assert.equal(calls, 3);
  });

  it('never replays mutation requests after a transient server failure', async () => {
    let calls = 0;
    const client = new GitHubApiClient({
      token: 'token',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ secret: 'must-not-escape' }, 503);
      },
    });

    await assert.rejects(
      () =>
        client.requestJson('/repos/o/r/issues/1', {
          method: 'PATCH',
          body: { state: 'closed' },
        }),
      new Error('GitHub API request failed with status 503'),
    );
    assert.equal(calls, 1);
  });

  it('does not retry non-transient client or server statuses', async () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 501]) {
      let calls = 0;
      const client = new GitHubApiClient({
        token: 'token',
        fetchImpl: async () => {
          calls += 1;
          return jsonResponse({ message: 'must-not-escape' }, status);
        },
      });

      await assert.rejects(
        () => client.requestJson('/repos/o/r'),
        new Error(`GitHub API request failed with status ${status}`),
      );
      assert.equal(calls, 1);
    }
  });
});
