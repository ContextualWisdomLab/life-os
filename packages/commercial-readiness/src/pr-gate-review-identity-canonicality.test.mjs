import assert from 'node:assert/strict';
import { it } from 'node:test';
import { evaluatePullRequestForMerge } from './pr-gate.mjs';

const headSha = 'a'.repeat(40);
const policy = {
  default_branch: 'main',
  required_workflows: [],
  required_statuses: [],
};

function pullRequestWithReviewer(actor) {
  return {
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    repository: 'o/r',
    head_repo: 'o/r',
    base_ref: 'main',
    head_sha: headSha,
    behind_by: 0,
    unresolved_threads: 0,
    reviews: [
      {
        actor,
        state: 'APPROVED',
        submitted_at: '2026-09-07T01:20:00Z',
        commit_id: headSha,
      },
    ],
    workflows: [],
    statuses: [],
  };
}

it('rejects padded decisive reviewer identity instead of trimming it into approval authority', () => {
  const padded = evaluatePullRequestForMerge(
    pullRequestWithReviewer('reviewer-a '),
    policy,
  );

  assert.equal(padded.eligible, false);
  assert.ok(padded.blockers.includes('review-evidence-invalid'));
  assert.ok(padded.blockers.includes('missing-approval'));

  const canonical = evaluatePullRequestForMerge(
    pullRequestWithReviewer('reviewer-a'),
    policy,
  );
  assert.equal(canonical.eligible, true);
  assert.deepEqual(canonical.blockers, []);
});

it('does not let a case-variant stale approval preserve exact-head approval authority', () => {
  const pullRequest = pullRequestWithReviewer('reviewer-a');
  pullRequest.reviews.push({
    actor: 'Reviewer-A',
    state: 'APPROVED',
    submitted_at: '2026-09-07T01:21:00Z',
    commit_id: 'b'.repeat(40),
  });

  const result = evaluatePullRequestForMerge(pullRequest, policy);

  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('review-evidence-invalid'));
});
