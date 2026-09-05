import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function snapshotClient(rawDraft) {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'feat: preserve Draft authority',
          state: 'open',
          ...(rawDraft === undefined ? {} : { draft: rawDraft }),
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: BASE_SHA },
          head: { sha: HEAD_SHA, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        return [
          {
            user: { login: 'reviewer-a' },
            state: 'APPROVED',
            submitted_at: '2026-09-05T14:00:00Z',
            commit_id: HEAD_SHA,
          },
        ];
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

async function collect(rawDraft) {
  return await collectRepositorySnapshot(snapshotClient(rawDraft), 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: [],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-05T14:05:00Z',
  });
}

describe('pull-request Draft authority collection', () => {
  it('retains malformed or missing GitHub Draft authority as fail-closed unknown evidence', async () => {
    for (const rawDraft of [undefined, null, 'false', 0]) {
      const snapshot = await collect(rawDraft);
      const pullRequest = snapshot.pull_requests[0];

      assert.equal(pullRequest.draft, null);
      assert.equal(pullRequest.eligible, false);
      assert.ok(pullRequest.blockers.includes('draft-state-unknown'));
    }
  });

  it('preserves explicit boolean GitHub Draft authority exactly', async () => {
    const ready = (await collect(false)).pull_requests[0];
    assert.equal(ready.draft, false);
    assert.equal(ready.blockers.includes('draft-state-unknown'), false);

    const draft = (await collect(true)).pull_requests[0];
    assert.equal(draft.draft, true);
    assert.equal(draft.blockers.includes('draft'), true);
    assert.equal(draft.blockers.includes('draft-state-unknown'), false);
  });
});
