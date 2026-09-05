import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function status(id, context, state = 'success') {
  return {
    id,
    context,
    state,
    sha: HEAD_SHA,
    created_at: new Date(Date.UTC(2026, 8, 6, 0, 0, id % 60)).toISOString(),
  };
}

function movingStatusPaginationFixture() {
  const originalStatuses = [
    status(200, 'CodeRabbit', 'success'),
    ...Array.from({ length: 100 }, (_, index) =>
      status(199 - index, `noise-${index}`),
    ),
  ];
  const movedStatuses = [
    status(201, 'CodeRabbit', 'failure'),
    ...originalStatuses.filter((item) => item.id !== 150),
  ];

  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: reject moving commit-status pagination',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: BASE_SHA },
          head: { sha: HEAD_SHA, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        return [
          {
            id: 1,
            user: { login: 'reviewer-a' },
            state: 'APPROVED',
            submitted_at: '2026-09-06T00:00:00Z',
            commit_id: HEAD_SHA,
          },
        ];
      }
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${HEAD_SHA}/statuses?`)) {
        const page = Number(new URL(`https://fixture.invalid${path}`).searchParams.get('page'));
        if (page === 1) return originalStatuses.slice(0, 100);
        if (page === 2) return movedStatuses.slice(100, 200);
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
}

test('fails closed when reverse-chronological commit-status pagination moves between pages', async () => {
  await assert.rejects(
    () =>
      collectRepositorySnapshot(movingStatusPaginationFixture(), 'o/r', {
        policy: {
          default_branch: 'main',
          required_workflows: [],
          required_statuses: ['CodeRabbit'],
          merge_method: 'squash',
        },
        commitSha: 'c'.repeat(40),
        generatedAt: '2026-09-06T00:05:00Z',
      }),
    /GitHub status response changed during pagination/u,
  );
});
