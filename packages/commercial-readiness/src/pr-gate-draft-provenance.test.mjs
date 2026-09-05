import assert from 'node:assert/strict';
import { it } from 'node:test';
import { evaluatePullRequestForMerge } from './pr-gate.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_PR = {
  state: 'open',
  draft: false,
  mergeable: true,
  mergeable_state: 'clean',
  base_ref: 'main',
  head_sha: HEAD_SHA,
  head_repo: 'ContextualWisdomLab/life-os',
  repository: 'ContextualWisdomLab/life-os',
  behind_by: 0,
  reviews: [
    {
      actor: 'reviewer-a',
      state: 'APPROVED',
      submitted_at: '2026-09-05T12:00:00Z',
      commit_id: HEAD_SHA,
    },
  ],
  unresolved_threads: 0,
  workflows: [],
  statuses: [],
};
const POLICY = {
  default_branch: 'main',
  required_workflows: [],
  required_statuses: [],
};

for (const draft of [undefined, null, 'false', 0]) {
  it(`fails closed when draft authority is malformed: ${String(draft)}`, () => {
    const result = evaluatePullRequestForMerge({ ...BASE_PR, draft }, POLICY);

    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes('draft-state-unknown'));
  });
}
