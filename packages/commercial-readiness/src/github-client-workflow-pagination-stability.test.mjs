import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function workflowRun(id, conclusion = 'success') {
  return {
    id,
    name: 'CI',
    status: 'completed',
    conclusion,
    head_sha: HEAD_SHA,
    run_attempt: 1,
    updated_at: `2026-09-05T01:${String(id % 60).padStart(2, '0')}:00Z`,
    pull_requests: [{ number: 7 }],
  };
}

/**
 * Simulate a same-head pull-request run arriving between REST offset pages.
 *
 * Page 1 is read from 101 successful runs. Before page 2, a newer failing run is inserted
 * at the head of GitHub's newest-first list, shifting the page boundary and duplicating run
 * 101 while the new run 201 is omitted from the traversal. A merge snapshot must reject
 * this moving pagination authority rather than retain the older successful run 200.
 *
 * @returns {{requestJson(path: string): Promise<unknown>}} Deterministic GitHub API fixture.
 */
function movingWorkflowPaginationFixture() {
  const originalRuns = Array.from({ length: 101 }, (_, index) =>
    workflowRun(200 - index),
  );
  const movedRuns = [workflowRun(201, 'failure'), ...originalRuns];

  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: reject moving workflow pagination',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: BASE_SHA },
          head: { sha: HEAD_SHA, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        return [
          {
            user: { login: 'reviewer-a' },
            state: 'APPROVED',
            submitted_at: '2026-09-05T01:00:00Z',
            commit_id: HEAD_SHA,
          },
        ];
      }
      if (path.includes('/actions/runs?') && path.includes('page=1')) {
        return { total_count: originalRuns.length, workflow_runs: originalRuns.slice(0, 100) };
      }
      if (path.includes('/actions/runs?') && path.includes('page=2')) {
        return { total_count: movedRuns.length, workflow_runs: movedRuns.slice(100, 200) };
      }
      if (path.startsWith(`/repos/o/r/commits/${HEAD_SHA}/statuses?`)) return [];
      if (path.startsWith('/repos/o/r/compare/')) return { behind_by: 0 };
      if (path === '/graphql') {
        return {
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
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };
}

describe('workflow-run pagination stability', () => {
  it('fails closed when same-head workflow-run pagination moves during collection', async () => {
    await assert.rejects(
      collectRepositorySnapshot(movingWorkflowPaginationFixture(), 'o/r', {
        policy: {
          default_branch: 'main',
          required_workflows: ['CI'],
          required_statuses: [],
          merge_method: 'squash',
        },
        commitSha: 'c'.repeat(40),
        generatedAt: '2026-09-05T01:05:00Z',
      }),
      /GitHub workflow run response changed during pagination/u,
    );
  });
});
