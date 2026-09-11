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

function issue(number) {
  return {
    number,
    title: `issue-${number}`,
    state: 'open',
    labels: [],
  };
}

function snapshotOptions() {
  return {
    policy: {
      default_branch: 'main',
      trusted_author_associations: ['OWNER'],
      required_workflows: [],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'e'.repeat(40),
    generatedAt: '2026-09-11T06:00:00Z',
  };
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

  const snapshot = await collectRepositorySnapshot(
    client,
    'o/r',
    snapshotOptions(),
  );

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

test('continues halving an oversized list page until one bounded page succeeds', async () => {
  const requestedPaths = [];
  const client = new GitHubApiClient({
    token: 'token',
    maxResponseBytes: 1024,
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      const path = `${requestUrl.pathname}${requestUrl.search}`;
      requestedPaths.push(path);
      if (path.startsWith('/repos/o/r/pulls?')) return jsonResponse([]);
      if (!path.startsWith('/repos/o/r/issues?')) {
        throw new Error(`Unexpected URL: ${url}`);
      }
      const pageSize = Number(requestUrl.searchParams.get('per_page'));
      if (pageSize > 25) {
        return jsonResponse([
          {
            number: 1,
            title: 'x'.repeat(2048),
            state: 'open',
            labels: [],
          },
        ]);
      }
      assert.equal(pageSize, 25);
      return jsonResponse([
        { number: 1, title: 'bounded-at-25', state: 'open', labels: [] },
      ]);
    },
  });

  const snapshot = await collectRepositorySnapshot(
    client,
    'o/r',
    snapshotOptions(),
  );

  assert.deepEqual(snapshot.issues, [
    { number: 1, title: 'bounded-at-25', state: 'open', labels: [] },
  ]);
  assert.equal(
    requestedPaths.some(
      (path) => path.includes('/issues?') && path.includes('per_page=25'),
    ),
    true,
  );
});

test('accepts exactly the bounded item limit after an empty confirmation page', async () => {
  const requestedPaths = [];
  const client = new GitHubApiClient({
    token: 'token',
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      const path = `${requestUrl.pathname}${requestUrl.search}`;
      requestedPaths.push(path);
      if (path.startsWith('/repos/o/r/pulls?')) return jsonResponse([]);
      if (path.startsWith('/repos/o/r/issues?')) {
        const pageSize = Number(requestUrl.searchParams.get('per_page'));
        const page = Number(requestUrl.searchParams.get('page'));
        assert.equal(pageSize, 100);
        const offset = (page - 1) * pageSize;
        const length = Math.max(0, Math.min(pageSize, 1000 - offset));
        return jsonResponse(
          Array.from({ length }, (_, index) => issue(offset + index + 1)),
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  const snapshot = await collectRepositorySnapshot(
    client,
    'o/r',
    snapshotOptions(),
  );

  assert.equal(snapshot.issues.length, 1000);
  assert.equal(snapshot.issues.at(-1)?.number, 1000);
  assert.equal(
    requestedPaths.some(
      (path) => path.includes('/issues?') && path.includes('page=11'),
    ),
    true,
  );
});

test('rejects the first item beyond the bounded item limit', async () => {
  const requestedPaths = [];
  const client = new GitHubApiClient({
    token: 'token',
    fetchImpl: async (url) => {
      const requestUrl = new URL(url);
      const path = `${requestUrl.pathname}${requestUrl.search}`;
      requestedPaths.push(path);
      if (path.startsWith('/repos/o/r/pulls?')) return jsonResponse([]);
      if (path.startsWith('/repos/o/r/issues?')) {
        const pageSize = Number(requestUrl.searchParams.get('per_page'));
        const page = Number(requestUrl.searchParams.get('page'));
        assert.equal(pageSize, 100);
        const offset = (page - 1) * pageSize;
        const length = Math.max(0, Math.min(pageSize, 1001 - offset));
        return jsonResponse(
          Array.from({ length }, (_, index) => issue(offset + index + 1)),
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  await assert.rejects(
    () => collectRepositorySnapshot(client, 'o/r', snapshotOptions()),
    /GitHub issue list was invalid exceeded the item limit/,
  );
  assert.equal(
    requestedPaths.some(
      (path) => path.includes('/issues?') && path.includes('page=11'),
    ),
    true,
  );
});
