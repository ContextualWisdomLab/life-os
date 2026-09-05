import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function review(id, state = 'COMMENTED') {
  return {
    id,
    user: { login: `reviewer-${id}` },
    state,
    submitted_at: new Date(Date.UTC(2026, 8, 6, 0, 0, id % 60)).toISOString(),
    commit_id: HEAD_SHA,
  };
}

function movingReviewPaginationFixture() {
  const originalReviews = [
    review(1, 'APPROVED'),
    ...Array.from({ length: 100 }, (_, index) => review(index + 2)),
  ];
  const movedFirstPage = originalReviews.slice(0, 100).map((item) =>
    item.id === 1 ? { ...item, state: 'DISMISSED' } : item,
  );
  let firstPageReads = 0;

  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: reject moving review pagination',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: BASE_SHA },
          head: { sha: HEAD_SHA, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        const page = Number(
          new URL(`https://fixture.invalid${path}`).searchParams.get('page'),
        );
        if (page === 1) {
          firstPageReads += 1;
          return firstPageReads === 1
            ? originalReviews.slice(0, 100)
            : movedFirstPage;
        }
        if (page === 2) return originalReviews.slice(100, 200);
      }
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
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

test('fails closed when merge-authoritative review pagination changes during traversal', async () => {
  await assert.rejects(
    () =>
      collectRepositorySnapshot(movingReviewPaginationFixture(), 'o/r', {
        policy: {
          default_branch: 'main',
          required_workflows: [],
          required_statuses: [],
          merge_method: 'squash',
        },
        commitSha: 'c'.repeat(40),
        generatedAt: '2026-09-06T00:10:00Z',
      }),
    /GitHub review response changed during pagination/u,
  );
});
