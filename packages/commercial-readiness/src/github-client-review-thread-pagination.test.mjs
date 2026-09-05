import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);

function snapshotClient(reviewThreads) {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: fail closed on review-thread evidence ambiguity',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: baseSha },
          head: { sha: headSha, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) return [];
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) {
        return [];
      }
      if (path.startsWith('/repos/o/r/compare/')) return { behind_by: 0 };
      if (path === '/graphql') {
        return {
          data: {
            repository: {
              pullRequest: { reviewThreads },
            },
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };
}

function collectWith(reviewThreads) {
  return collectRepositorySnapshot(snapshotClient(reviewThreads), 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: [],
      required_statuses: [],
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-05T06:10:00Z',
  });
}

it('fails closed when review-thread pagination claims another page without a cursor', async () => {
  await assert.rejects(
    () =>
      collectWith({
        nodes: [],
        pageInfo: { hasNextPage: true, endCursor: null },
      }),
    new Error('GitHub review thread response pagination was invalid'),
  );
});

it('fails closed when a review thread omits its resolved-state authority', async () => {
  await assert.rejects(
    () =>
      collectWith({
        nodes: [{}],
        pageInfo: { hasNextPage: false, endCursor: null },
      }),
    new Error('GitHub review thread response was invalid'),
  );
});
