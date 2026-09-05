import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePullRequestForMerge } from './pr-gate.mjs';

const HEAD_SHA = 'a'.repeat(40);

function otherwiseGreenPullRequest(reviews) {
  return {
    state: 'open',
    draft: false,
    repository: 'ContextualWisdomLab/life-os',
    head_repo: 'ContextualWisdomLab/life-os',
    base_ref: 'main',
    head_sha: HEAD_SHA,
    mergeable: true,
    mergeable_state: 'clean',
    behind_by: 0,
    unresolved_threads: 0,
    reviews,
    workflows: [],
    statuses: [],
  };
}

const policy = {
  default_branch: 'main',
  required_workflows: [],
  required_statuses: [],
};

test('unknown GitHub review states fail closed instead of disappearing beside a valid approval', () => {
  const result = evaluatePullRequestForMerge(
    otherwiseGreenPullRequest([
      {
        actor: 'independent-reviewer',
        state: 'APPROVED',
        submitted_at: '2026-09-06T00:00:00Z',
        commit_id: HEAD_SHA,
      },
      {
        actor: 'second-reviewer',
        state: 'UNRECOGNIZED_REVIEW_STATE',
        submitted_at: '2026-09-06T00:01:00Z',
        commit_id: HEAD_SHA,
      },
    ]),
    policy,
  );

  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('review-evidence-invalid'));
});
