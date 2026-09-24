import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

/**
 * Build one bounded GitHub client fixture where two PRs share the same head commit.
 *
 * PR 7 owns a failing CI run while PR 8 owns a newer successful CI run. The snapshot for
 * PR 7 must retain only its own pull-request-triggered workflow evidence.
 *
 * @returns {{requestJson(path: string): Promise<unknown>}} Deterministic GitHub API fixture.
 */
function sameHeadWorkflowFixture() {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: preserve workflow PR provenance',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: BASE_SHA },
          head: { sha: HEAD_SHA, repo: { full_name: 'o/r' } },
          user: { login: 'pr-author' },
          author_association: 'OWNER',
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
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return {
          total_count: 2,
          workflow_runs: [
            {
              id: 100,
              name: 'CI',
              status: 'completed',
              conclusion: 'failure',
              head_sha: HEAD_SHA,
              run_attempt: 1,
              updated_at: '2026-09-05T01:01:00Z',
              pull_requests: [{ number: 7 }],
            },
            {
              id: 101,
              name: 'CI',
              status: 'completed',
              conclusion: 'success',
              head_sha: HEAD_SHA,
              run_attempt: 1,
              updated_at: '2026-09-05T01:02:00Z',
              pull_requests: [{ number: 8 }],
            },
          ],
        };
      }
      if (path.startsWith(`/repos/o/r/commits/${HEAD_SHA}/statuses?`)) return [];
      if (
        path ===
        `/repos/o/r/compare/${BASE_SHA}...${HEAD_SHA}?per_page=1&page=2`
      ) {
        return {
          url: `https://api.github.com/repos/o/r/compare/${BASE_SHA}...${HEAD_SHA}`,
          behind_by: 0,
          base_commit: { sha: BASE_SHA },
          merge_base_commit: { sha: BASE_SHA },
        };
      }
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

describe('repository workflow evidence provenance', () => {
  it('rejects a newer same-head workflow result that belongs to another pull request', async () => {
    const snapshot = await collectRepositorySnapshot(
      sameHeadWorkflowFixture(),
      'o/r',
      {
        policy: {
          default_branch: 'main',
          required_workflows: ['CI'],
          required_statuses: [],
          merge_method: 'squash',
        },
        commitSha: 'c'.repeat(40),
        generatedAt: '2026-09-05T01:05:00Z',
      },
    );

    const pullRequest = snapshot.pull_requests[0];
    assert.equal(pullRequest.workflows.length, 1);
    assert.equal(pullRequest.workflows[0].conclusion, 'failure');
    assert.equal(pullRequest.eligible, false);
    assert.deepEqual(pullRequest.blockers, ['workflow-not-successful:CI']);
  });
});
