import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectRepositorySnapshot,
  GitHubApiClient,
} from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const RESPONSE_LIMIT = 30_000;

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

function workflowRun(id, paddingLength = 180) {
  return {
    id,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    head_sha: HEAD_SHA,
    run_attempt: 1,
    updated_at: '2026-09-11T10:00:00Z',
    pull_requests: [{ number: 7 }],
    padding: 'x'.repeat(paddingLength),
  };
}

function boundedWorkflowFetch({ paddingLength = 180 } = {}) {
  const calls = [];
  const runs = Array.from({ length: 100 }, (_, index) =>
    workflowRun(1_000 - index, paddingLength),
  );

  return {
    calls,
    async fetch(url) {
      const parsed = new URL(url);
      const { pathname, searchParams } = parsed;
      calls.push(`${pathname}?${searchParams.toString()}`);

      if (pathname === '/repos/o/r/pulls') return jsonResponse([{ number: 7 }]);
      if (pathname === '/repos/o/r/issues') return jsonResponse([]);
      if (pathname === '/repos/o/r/pulls/7') {
        return jsonResponse({
          number: 7,
          title: 'fix: preserve bounded workflow evidence',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          author_association: 'OWNER',
          user: { login: 'pr-author' },
          base: { ref: 'main', sha: BASE_SHA },
          head: { sha: HEAD_SHA, repo: { full_name: 'o/r' } },
        });
      }
      if (pathname === '/repos/o/r/pulls/7/reviews') {
        return jsonResponse([
          {
            user: { login: 'reviewer-a' },
            state: 'APPROVED',
            submitted_at: '2026-09-11T09:55:00Z',
            commit_id: HEAD_SHA,
          },
        ]);
      }
      if (pathname === '/repos/o/r/actions/runs') {
        const perPage = Number(searchParams.get('per_page'));
        const page = Number(searchParams.get('page'));
        const start = (page - 1) * perPage;
        return jsonResponse({
          total_count: runs.length,
          workflow_runs: runs.slice(start, start + perPage),
        });
      }
      if (pathname === `/repos/o/r/commits/${HEAD_SHA}/statuses`) {
        return jsonResponse([]);
      }
      if (pathname === `/repos/o/r/compare/${BASE_SHA}...${HEAD_SHA}`) {
        return jsonResponse({
          url: `https://api.github.com/repos/o/r/compare/${BASE_SHA}...${HEAD_SHA}`,
          base_commit: { sha: BASE_SHA },
          merge_base_commit: { sha: BASE_SHA },
          behind_by: 0,
        });
      }
      if (pathname === '/graphql') {
        return jsonResponse({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        });
      }
      throw new Error(`Unexpected GitHub API path: ${pathname}`);
    },
  };
}

describe('workflow-run response bounds', () => {
  it('restarts workflow pagination at 50 when a 100-run page exceeds the response byte limit', async () => {
    const fixture = boundedWorkflowFetch();
    const client = new GitHubApiClient({
      token: 'test-token',
      fetchImpl: fixture.fetch,
      maxResponseBytes: RESPONSE_LIMIT,
    });

    const snapshot = await collectRepositorySnapshot(client, 'o/r', {
      policy: {
        default_branch: 'main',
        required_workflows: ['CI'],
        required_statuses: [],
        merge_method: 'squash',
      },
      commitSha: 'c'.repeat(40),
      generatedAt: '2026-09-11T10:05:00Z',
    });

    assert.equal(snapshot.pull_requests[0].eligible, true);
    assert.equal(
      fixture.calls.some(
        (path) =>
          path.startsWith('/repos/o/r/actions/runs?') &&
          path.includes('per_page=100'),
      ),
      true,
    );
    assert.equal(
      fixture.calls.some(
        (path) =>
          path.startsWith('/repos/o/r/actions/runs?') &&
          path.includes('per_page=50'),
      ),
      true,
    );
  });

  it('continues halving oversized workflow-run pages until one bounded page succeeds', async () => {
    const fixture = boundedWorkflowFetch({ paddingLength: 500 });
    const client = new GitHubApiClient({
      token: 'test-token',
      fetchImpl: fixture.fetch,
      maxResponseBytes: RESPONSE_LIMIT,
    });

    const snapshot = await collectRepositorySnapshot(client, 'o/r', {
      policy: {
        default_branch: 'main',
        required_workflows: ['CI'],
        required_statuses: [],
        merge_method: 'squash',
      },
      commitSha: 'c'.repeat(40),
      generatedAt: '2026-09-11T10:05:00Z',
    });

    assert.equal(snapshot.pull_requests[0].eligible, true);
    for (const pageSize of [100, 50, 25]) {
      assert.equal(
        fixture.calls.some(
          (path) =>
            path.startsWith('/repos/o/r/actions/runs?') &&
            path.includes(`per_page=${pageSize}`),
        ),
        true,
      );
    }
  });
});
