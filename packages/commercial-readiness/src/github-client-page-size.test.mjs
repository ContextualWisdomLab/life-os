import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectRepositorySnapshot,
  GitHubApiClient,
} from './github-client.mjs';

function jsonResponse(value) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(body)),
    },
  });
}

test('retries an oversized list page with a smaller bounded page size', async () => {
  const requestedPaths = [];
  const client = new GitHubApiClient({
    token: 'token',
    maxResponseBytes: 1024,
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      const path = `${requestUrl.pathname}${requestUrl.search}`;
      requestedPaths.push(path);
      if (path.startsWith('/repos/o/r/pulls?')) return jsonResponse([]);
      if (
        path.startsWith('/repos/o/r/issues?') &&
        path.includes('per_page=100')
      ) {
        return jsonResponse([
          {
            number: 1,
            title: 'x'.repeat(2048),
            state: 'open',
            labels: [],
          },
        ]);
      }
      if (
        path.startsWith('/repos/o/r/issues?') &&
        path.includes('per_page=50')
      ) {
        return jsonResponse([
          { number: 1, title: 'bounded', state: 'open', labels: [] },
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const snapshot = await collectRepositorySnapshot(client, 'o/r', {
    policy: {
      default_branch: 'main',
      trusted_author_associations: ['OWNER'],
      required_workflows: [],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'e'.repeat(40),
    generatedAt: '2026-09-11T06:00:00Z',
  });

  assert.deepEqual(snapshot.issues, [
    { number: 1, title: 'bounded', state: 'open', labels: [] },
  ]);
  assert.equal(
    requestedPaths.some(
      (path) => path.includes('/issues?') && path.includes('per_page=100'),
    ),
    true,
  );
  assert.equal(
    requestedPaths.some(
      (path) => path.includes('/issues?') && path.includes('per_page=50'),
    ),
    true,
  );
});
