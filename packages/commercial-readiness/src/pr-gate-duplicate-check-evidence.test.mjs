import assert from 'node:assert/strict';
import { it } from 'node:test';
import { evaluatePullRequestForMerge } from './pr-gate.mjs';

const HEAD = 'abcdef0123456789abcdef0123456789abcdef01';
const STALE_HEAD = '0123456789abcdef0123456789abcdef01234567';
const POLICY = {
  default_branch: 'main',
  required_workflows: ['CI'],
  required_statuses: ['quality'],
};

function eligiblePullRequest() {
  return {
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    base_ref: 'main',
    head_sha: HEAD,
    head_repo: 'ContextualWisdomLab/life-os',
    repository: 'ContextualWisdomLab/life-os',
    behind_by: 0,
    reviews: [
      {
        actor: 'reviewer-a',
        state: 'APPROVED',
        submitted_at: '2026-09-07T04:00:00Z',
        commit_id: HEAD,
      },
    ],
    unresolved_threads: 0,
    workflows: [
      {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        head_sha: HEAD,
      },
    ],
    statuses: [{ context: 'quality', state: 'success', sha: HEAD }],
  };
}

it('rejects duplicate exact-head workflow evidence even when one record succeeds', () => {
  const pullRequest = eligiblePullRequest();
  pullRequest.workflows.push({
    name: 'CI',
    status: 'completed',
    conclusion: 'failure',
    head_sha: HEAD,
  });

  const result = evaluatePullRequestForMerge(pullRequest, POLICY);

  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('workflow-evidence-ambiguous:CI'));
});

it('rejects duplicate exact-head status evidence even when one record succeeds', () => {
  const pullRequest = eligiblePullRequest();
  pullRequest.statuses.push({ context: 'quality', state: 'failure', sha: HEAD });

  const result = evaluatePullRequestForMerge(pullRequest, POLICY);

  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('status-evidence-ambiguous:quality'));
});

it('rejects same-name stale check evidence beside an exact-head success', () => {
  const pullRequest = eligiblePullRequest();
  pullRequest.workflows.push({
    name: 'CI',
    status: 'completed',
    conclusion: 'failure',
    head_sha: STALE_HEAD,
  });
  pullRequest.statuses.push({
    context: 'quality',
    state: 'failure',
    sha: STALE_HEAD,
  });

  const result = evaluatePullRequestForMerge(pullRequest, POLICY);

  assert.equal(result.eligible, false);
  assert.ok(result.blockers.includes('workflow-evidence-ambiguous:CI'));
  assert.ok(result.blockers.includes('status-evidence-ambiguous:quality'));
});
