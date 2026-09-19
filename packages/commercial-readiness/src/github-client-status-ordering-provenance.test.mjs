import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

it('fails closed when exact-head status ordering evidence has a malformed identity', async () => {
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const client = {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: require status ordering provenance',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: baseSha },
          head: { sha: headSha, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        return [
          {
            user: { login: 'reviewer-a' },
            state: 'APPROVED',
            submitted_at: '2026-09-05T06:00:00Z',
            commit_id: headSha,
          },
        ];
      }
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) {
        return [
          {
            id: 100,
            context: 'CodeRabbit',
            state: 'success',
            sha: headSha,
            created_at: '2026-09-05T05:00:00Z',
          },
          {
            id: null,
            context: 'CodeRabbit',
            state: 'failure',
            sha: headSha,
            created_at: '2026-09-05T06:00:00Z',
          },
        ];
      }
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

  const snapshot = await collectRepositorySnapshot(client, 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: [],
      required_statuses: ['CodeRabbit'],
      merge_method: 'squash',
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-05T06:05:00Z',
  });

  const [pullRequest] = snapshot.pull_requests;
  assert.equal(pullRequest.eligible, false);
  assert.ok(pullRequest.blockers.includes('status-not-successful:CodeRabbit'));
});
