import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const OTHER_SHA = 'd'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function workflowRun(id, headSha, conclusion) {
  return {
    id,
    name: 'CI',
    status: 'completed',
    conclusion,
    head_sha: headSha,
    run_attempt: 1,
    updated_at: '2026-09-05T18:30:00Z',
    pull_requests: [{ number: 7 }],
  };
}

function fixtureClient() {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: reject contradictory workflow head provenance',
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
            submitted_at: '2026-09-05T18:29:00Z',
            commit_id: HEAD_SHA,
          },
        ];
      }
      if (path.includes('/actions/runs?')) {
        return {
          total_count: 2,
          workflow_runs: [
            workflowRun(200, HEAD_SHA, 'success'),
            workflowRun(199, OTHER_SHA, 'failure'),
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

describe('workflow-run exact-head provenance', () => {
  it('fails closed when the same required workflow also carries mismatched head provenance', async () => {
    const snapshot = await collectRepositorySnapshot(fixtureClient(), 'o/r', {
      policy: {
        default_branch: 'main',
        required_workflows: ['CI'],
        required_statuses: [],
        merge_method: 'squash',
      },
      commitSha: 'c'.repeat(40),
      generatedAt: '2026-09-05T18:31:00Z',
    });

    assert.equal(snapshot.pull_requests[0].eligible, false);
    assert.ok(
      snapshot.pull_requests[0].blockers.includes('workflow-not-successful:CI'),
      'contradictory workflow head provenance must taint the required workflow',
    );
  });
});
