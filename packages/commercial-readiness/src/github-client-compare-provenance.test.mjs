import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

function compareFixtureClient({ baseSha, headSha, comparePayload }) {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'compare provenance fixture',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          author_association: 'OWNER',
          base: { ref: 'main', sha: baseSha },
          head: { sha: headSha, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) return [];
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) return [];
      if (path.startsWith('/repos/o/r/compare/')) return comparePayload;
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

it('does not grant current-base authority to a compare response bound to another base commit', async () => {
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const client = compareFixtureClient({
    baseSha,
    headSha,
    comparePayload: {
      url: `https://api.github.com/repos/o/r/compare/${baseSha}...${headSha}`,
      base_commit: { sha: 'c'.repeat(40) },
      merge_base_commit: { sha: baseSha },
      behind_by: 0,
    },
  });

  const snapshot = await collectRepositorySnapshot(client, 'o/r', {
    policy: {
      default_branch: 'main',
      trusted_author_associations: ['OWNER'],
      required_workflows: [],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'd'.repeat(40),
    generatedAt: '2026-09-06T10:00:00Z',
  });

  assert.equal(snapshot.pull_requests[0].behind_by, -1);
  assert.ok(snapshot.pull_requests[0].blockers.includes('base-out-of-date'));
});
