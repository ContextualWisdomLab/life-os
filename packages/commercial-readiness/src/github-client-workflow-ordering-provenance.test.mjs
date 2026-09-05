import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function workflowOrderingFixture(overrides) {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: reject malformed workflow ordering evidence',
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
            submitted_at: '2026-09-06T00:00:00Z',
            commit_id: HEAD_SHA,
          },
        ];
      }
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return {
          total_count: 1,
          workflow_runs: [
            {
              id: 100,
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
              head_sha: HEAD_SHA,
              run_attempt: 1,
              updated_at: '2026-09-06T00:01:00Z',
              pull_requests: [{ number: 7 }],
              ...overrides,
            },
          ],
        };
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

async function collectWithWorkflow(overrides) {
  return await collectRepositorySnapshot(workflowOrderingFixture(overrides), 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: ['CI'],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-06T00:02:00Z',
  });
}

describe('repository workflow ordering provenance', () => {
  it('fails closed when a successful exact-head run has a malformed run attempt', async () => {
    const snapshot = await collectWithWorkflow({ run_attempt: 0 });
    const pullRequest = snapshot.pull_requests[0];

    assert.equal(pullRequest.eligible, false);
    assert.ok(pullRequest.blockers.includes('workflow-not-successful:CI'));
  });

  it('fails closed when a successful exact-head run has a malformed update timestamp', async () => {
    const snapshot = await collectWithWorkflow({ updated_at: 'not-a-timestamp' });
    const pullRequest = snapshot.pull_requests[0];

    assert.equal(pullRequest.eligible, false);
    assert.ok(pullRequest.blockers.includes('workflow-not-successful:CI'));
  });
});
