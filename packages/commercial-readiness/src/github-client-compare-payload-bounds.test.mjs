import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

it('requests compare freshness from a file-free paginated response', async () => {
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const comparePath = `/repos/o/r/compare/${baseSha}...${headSha}?per_page=1&page=2`;
  const calls = [];
  const client = {
    async requestJson(path) {
      calls.push(path);
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'bounded compare fixture',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          author_association: 'OWNER',
          user: { login: 'owner' },
          base: { ref: 'main', sha: baseSha },
          head: { sha: headSha, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) return [];
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) return [];
      if (path.startsWith('/repos/o/r/compare/')) {
        return {
          url: `https://api.github.com/repos/o/r/compare/${baseSha}...${headSha}`,
          base_commit: { sha: baseSha },
          merge_base_commit: { sha: baseSha },
          behind_by: 0,
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

  const snapshot = await collectRepositorySnapshot(client, 'o/r', {
    policy: {
      default_branch: 'main',
      trusted_author_associations: ['OWNER'],
      required_workflows: [],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-09T20:15:00Z',
  });

  assert.equal(snapshot.pull_requests[0].behind_by, 0);
  assert.ok(calls.includes(comparePath));
  assert.equal(
    calls.some(
      (path) =>
        path.startsWith(`/repos/o/r/compare/${baseSha}...${headSha}`) &&
        path !== comparePath,
    ),
    false,
  );
});
