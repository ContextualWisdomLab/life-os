import assert from 'node:assert/strict';
import { it } from 'node:test';
import { evaluatePullRequestForMerge } from './pr-gate.mjs';

const CANONICAL_HEAD = 'abcdef0123456789abcdef0123456789abcdef01';
const POLICY = {
  default_branch: 'main',
  required_workflows: ['CI'],
  required_statuses: [],
};

function eligiblePullRequest(headSha) {
  return {
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    base_ref: 'main',
    head_sha: headSha,
    head_repo: 'ContextualWisdomLab/life-os',
    repository: 'ContextualWisdomLab/life-os',
    behind_by: 0,
    reviews: [
      {
        actor: 'reviewer-a',
        state: 'APPROVED',
        submitted_at: '2026-09-07T00:00:00Z',
        commit_id: headSha,
      },
    ],
    unresolved_threads: 0,
    workflows: [
      {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        head_sha: headSha,
      },
    ],
    statuses: [],
  };
}

it('rejects uppercase aliases for exact pull-request head authority', () => {
  const result = evaluatePullRequestForMerge(
    eligiblePullRequest(CANONICAL_HEAD.toUpperCase()),
    POLICY,
  );

  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('invalid-head'));
});

it('retains canonical lowercase exact-head authority', () => {
  const result = evaluatePullRequestForMerge(
    eligiblePullRequest(CANONICAL_HEAD),
    POLICY,
  );

  assert.equal(result.eligible, true);
  assert.deepEqual(result.blockers, []);
});
