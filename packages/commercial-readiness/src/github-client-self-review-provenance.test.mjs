import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);
const REPOSITORY = 'o/r';

const policy = {
  default_branch: 'main',
  trusted_author_associations: ['OWNER'],
  required_workflows: [],
  required_statuses: [],
  merge_method: 'squash',
};

function clientWithReviewer(reviewerLogin) {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: require independent approval',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          author_association: 'OWNER',
          user: { login: 'author-a' },
          base: { ref: 'main', sha: BASE_SHA },
          head: { sha: HEAD_SHA, repo: { full_name: REPOSITORY } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        return [
          {
            user: { login: reviewerLogin },
            state: 'APPROVED',
            submitted_at: '2026-09-06T11:00:00Z',
            commit_id: HEAD_SHA,
          },
        ];
      }
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${HEAD_SHA}/statuses?`)) {
        return [];
      }
      if (path.startsWith('/repos/o/r/compare/')) {
        return {
          url: `https://api.github.com/repos/${REPOSITORY}/compare/${BASE_SHA}...${HEAD_SHA}`,
          base_commit: { sha: BASE_SHA },
          merge_base_commit: { sha: BASE_SHA },
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
}

async function snapshotForReviewer(reviewerLogin) {
  return await collectRepositorySnapshot(clientWithReviewer(reviewerLogin), REPOSITORY, {
    policy,
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-06T11:01:00Z',
  });
}

describe('pull request review independence provenance', () => {
  it('does not let the pull request author become merge-authoritative approval evidence', async () => {
    const snapshot = await snapshotForReviewer('author-a');
    const pullRequest = snapshot.pull_requests[0];

    assert.equal(pullRequest.eligible, false);
    assert.ok(pullRequest.blockers.includes('review-evidence-invalid'));
    assert.ok(pullRequest.blockers.includes('missing-approval'));
  });

  it('preserves exact-head approval from a distinct reviewer', async () => {
    const snapshot = await snapshotForReviewer('reviewer-b');
    assert.deepEqual(snapshot.pull_requests[0].blockers, []);
    assert.equal(snapshot.pull_requests[0].eligible, true);
  });
});
