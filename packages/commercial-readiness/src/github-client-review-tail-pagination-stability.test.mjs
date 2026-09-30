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
    submitted_at: new Date(Date.UTC(2026, 8, 14, 0, 0, id % 60)).toISOString(),
    commit_id: HEAD_SHA,
  };
}

function movingTailReviewPaginationFixture() {
  const firstPage = Array.from({ length: 100 }, (_, index) => review(index + 1));
  const originalSecondPage = [review(101, 'APPROVED')];
  const movedSecondPage = [review(101, 'DISMISSED')];
  let secondPageReads = 0;

  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: reject moving review tail pagination',
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
        if (page === 1) return firstPage;
        if (page === 2) {
          secondPageReads += 1;
          return secondPageReads === 1 ? originalSecondPage : movedSecondPage;
        }
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

test('fails closed when a later merge-authoritative review page changes while page one stays stable', async () => {
  await assert.rejects(
    () =>
      collectRepositorySnapshot(movingTailReviewPaginationFixture(), 'o/r', {
        policy: {
          default_branch: 'main',
          required_workflows: [],
          required_statuses: [],
          merge_method: 'squash',
        },
        commitSha: 'c'.repeat(40),
        generatedAt: '2026-09-14T06:00:00Z',
      }),
    /GitHub review response changed during pagination/u,
  );
});
