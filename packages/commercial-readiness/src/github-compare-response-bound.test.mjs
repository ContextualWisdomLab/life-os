import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectRepositorySnapshot } from './github-client.mjs';

test('reads compare metadata from a non-first paginated page', async () => {
  const headSha = 'a'.repeat(40);
  const baseSha = 'b'.repeat(40);
  const calls = [];
  const client = {
    async requestJson(path) {
      calls.push(path);
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'large comparison',
          state: 'open',
          draft: true,
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

  await collectRepositorySnapshot(client, 'o/r', {
    policy: {
      default_branch: 'main',
      trusted_author_associations: ['OWNER'],
      required_workflows: [],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-15T13:45:00Z',
  });

  const comparePath = calls.find((path) => path.startsWith('/repos/o/r/compare/'));
  assert.ok(comparePath, 'compare metadata request must exist');
  assert.match(comparePath, /\?per_page=1&page=2$/);
});
