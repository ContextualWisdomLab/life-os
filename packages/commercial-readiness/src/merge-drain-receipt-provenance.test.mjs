import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeEligiblePullRequests } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const MERGE_SHA = 'b'.repeat(40);

function eligiblePullRequest() {
  return {
    number: 247,
    title: 'exact-head merge receipt fixture',
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    base_ref: 'main',
    head_sha: HEAD_SHA,
    head_repo: 'ContextualWisdomLab/life-os',
    repository: 'ContextualWisdomLab/life-os',
    behind_by: 0,
    unresolved_threads: 0,
    reviews: [
      {
        actor: 'reviewer-a',
        state: 'APPROVED',
        submitted_at: '2026-09-07T06:00:00Z',
        commit_id: HEAD_SHA,
      },
    ],
    workflows: [],
    statuses: [],
  };
}

describe('merge drain receipt provenance', () => {
  it('retains the validated GitHub merge commit SHA in the durable drain result', async () => {
    const candidate = eligiblePullRequest();
    const results = await mergeEligiblePullRequests({
      repository: 'ContextualWisdomLab/life-os',
      policy: {
        default_branch: 'main',
        required_workflows: [],
        required_statuses: [],
        merge_method: 'squash',
      },
      dryRun: false,
      collectPullRequests: async () => [candidate],
      mergePullRequest: async () => ({ merged: true, sha: MERGE_SHA }),
    });

    assert.deepEqual(results, [
      { number: 247, action: 'merged', merge_sha: MERGE_SHA },
    ]);
  });
});
