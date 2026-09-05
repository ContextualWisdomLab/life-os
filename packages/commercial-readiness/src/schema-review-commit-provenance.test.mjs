import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';
import { validateGitHubSnapshot } from './schema.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);

function snapshotClient() {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: preserve exact-head approval provenance',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: baseSha },
          head: { sha: headSha, repo: { full_name: 'o/r' } },
          author_association: 'MEMBER',
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        return [
          {
            user: { login: 'reviewer-a' },
            state: 'APPROVED',
            submitted_at: '2026-09-05T20:00:00Z',
            commit_id: headSha,
          },
        ];
      }
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) return [];
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

it('preserves review commit binding through collector and snapshot validation', async () => {
  const collected = await collectRepositorySnapshot(snapshotClient(), 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: [],
      required_statuses: [],
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-05T20:01:00Z',
  });

  assert.equal(collected.pull_requests[0].eligible, true);
  assert.equal(collected.pull_requests[0].reviews[0].commit_id, headSha);

  const validated = validateGitHubSnapshot(collected);
  assert.equal(validated.pull_requests[0].reviews[0].commit_id, headSha);
});
