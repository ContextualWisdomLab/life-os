import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const compareUrl = `https://api.github.com/repos/o/r/compare/${baseSha}...${headSha}`;

function reviewThreadPage(start, count, unresolvedIndex = -1) {
  return Array.from({ length: count }, (_, index) => ({
    id: `PRRT_${start + index}`,
    isResolved: index !== unresolvedIndex,
  }));
}

function snapshotClient({ driftOnConfirmation = false, unresolvedTail = false }) {
  let firstPageReads = 0;
  return {
    get firstPageReads() {
      return firstPageReads;
    },
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
                    nodes: reviewThreadPage(
                      0,
                      100,
                      driftOnConfirmation && firstPageReads > 1 ? 0 : -1,
                    ),
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
                    nodes: reviewThreadPage(100, 1, unresolvedTail ? 0 : -1),
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
}

function collect(client) {
  return collectRepositorySnapshot(client, 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: [],
      required_statuses: [],
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-14T10:00:00Z',
  });
}

it('fails closed when an earlier review-thread page changes during a multi-page traversal', async () => {
  const client = snapshotClient({ driftOnConfirmation: true });
  await assert.rejects(
    () => collect(client),
    new Error('GitHub review thread response changed during pagination'),
  );
  assert.equal(client.firstPageReads, 2);
});

it('accepts a stable multi-page review-thread traversal and preserves unresolved count', async () => {
  const client = snapshotClient({ unresolvedTail: true });
  const snapshot = await collect(client);
  assert.equal(client.firstPageReads, 2);
  assert.equal(snapshot.pull_requests[0].unresolved_threads, 1);
  assert.ok(snapshot.pull_requests[0].blockers.includes('unresolved-review-threads'));
});
