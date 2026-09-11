import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GitHubApiClient } from './github-client.mjs';

test('preserves the response-size classification when stream cancellation fails', async () => {
  const oversizedChunk = new TextEncoder().encode(
    JSON.stringify({ data: 'x'.repeat(2048) }),
  );
  let cancelCalls = 0;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(oversizedChunk);
    },
    cancel() {
      cancelCalls += 1;
      return Promise.reject(new Error('upstream cancellation failed'));
    },
  });
  const client = new GitHubApiClient({
    token: 'token',
    maxResponseBytes: 1024,
    fetchImpl: async () =>
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  });

  await assert.rejects(
    () => client.requestJson('/repos/o/r/issues'),
    new Error('GitHub API response exceeded the size limit'),
  );
  assert.equal(cancelCalls, 1);
});

test('cancels a declared-oversized response before rejecting it', async () => {
  let cancelCalls = 0;
  const body = new ReadableStream({
    cancel() {
      cancelCalls += 1;
    },
  });
  const client = new GitHubApiClient({
    token: 'token',
    maxResponseBytes: 1024,
    fetchImpl: async () =>
      new Response(body, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': '2048',
        },
      }),
  });

  await assert.rejects(
    () => client.requestJson('/repos/o/r/issues'),
    new Error('GitHub API response exceeded the size limit'),
  );
  assert.equal(cancelCalls, 1);
});