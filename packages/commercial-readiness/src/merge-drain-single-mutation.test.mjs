import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeEligiblePullRequests } from './github-client.mjs';

const policy = {
  default_branch: 'main',
  trusted_author_associations: ['OWNER'],
  required_workflows: [],
  required_statuses: [],
  merge_method: 'squash',
};

function eligiblePullRequest(number, headSha) {
  return {
    number,
    title: `ready-${number}`,
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    base_ref: 'main',
    head_sha: headSha,
    head_repo: 'o/r',
    repository: 'o/r',
    author_association: 'OWNER',
    behind_by: 0,
    reviews: [
      {
        actor: 'reviewer-a',
        state: 'APPROVED',
        submitted_at: '2026-09-06T00:00:00Z',
        commit_id: headSha,
      },
    ],
    unresolved_threads: 0,
    workflows: [],
    statuses: [],
  };
}

describe('merge drain mutation authority', () => {
  it('records one successful merge and defers later eligible PRs after main advances', async () => {
    const first = eligiblePullRequest(301, 'a'.repeat(40));
    const second = eligiblePullRequest(302, 'b'.repeat(40));
    let mergeCalls = 0;

    const result = await mergeEligiblePullRequests({
      repository: 'o/r',
      policy,
      dryRun: false,
      collectPullRequests: async () => [first, second],
      mergePullRequest: async () => {
        mergeCalls += 1;
        if (mergeCalls > 1) {
          throw new Error('a drain run must not mutate main twice');
        }
        return { merged: true, sha: 'c'.repeat(40) };
      },
    });

    assert.equal(mergeCalls, 1);
    assert.deepEqual(result, [
      { number: 301, action: 'merged' },
      {
        number: 302,
        action: 'blocked',
        blockers: ['default-branch-advanced'],
      },
    ]);
  });
});
