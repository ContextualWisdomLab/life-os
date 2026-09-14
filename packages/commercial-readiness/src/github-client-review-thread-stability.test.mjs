import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const compareUrl = `https://api.github.com/repos/o/r/compare/${baseSha}...${headSha}`;

function reviewThreadPage(start, count, firstThreadUnresolved = false) {
  return Array.from({ length: count }, (_, index) => ({
    id: `PRRT_${start + index}`,
    isResolved: firstThreadUnresolved && index === 0 ? false : true,
  }));
}

it('fails closed when an earlier review-thread page changes during a multi-page traversal', async () => {
  let firstPageReads = 0;
  const client = {
    async requestJson(path, options = {}) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: keep review-thread merge evidence stable',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          user: { login: 'author-a' },
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
          url: compareUrl,
          base_commit: { sha: baseSha },
          merge_base_commit: { sha: baseSha },
          behind_by: 0,
        };
      }
      if (path === '/graphql') {
        const cursor = options.body?.variables?.cursor ?? null;
        if (cursor === null) {
          firstPageReads += 1;
          return {
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: reviewThreadPage(0, 100, firstPageReads > 1),
                    pageInfo: { hasNextPage: true, endCursor: 'cursor-1' },
                  },
                },
              },
            },
          };
        }
        if (cursor === 'cursor-1') {
          return {
            data: {
              repository: {
                pullRequest: {
                  reviewThreads: {
                    nodes: reviewThreadPage(100, 1),
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            },
          };
        }
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };

  await assert.rejects(
    () =>
      collectRepositorySnapshot(client, 'o/r', {
        policy: {
          default_branch: 'main',
          required_workflows: [],
          required_statuses: [],
        },
        commitSha: 'c'.repeat(40),
        generatedAt: '2026-09-14T10:00:00Z',
      }),
    new Error('GitHub review thread response changed during pagination'),
  );
});
