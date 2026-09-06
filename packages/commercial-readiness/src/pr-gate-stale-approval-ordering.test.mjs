import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluatePullRequestForMerge } from './pr-gate.mjs';

const HEAD_SHA = 'a'.repeat(40);
const STALE_SHA = 'b'.repeat(40);

function pullRequest(reviews) {
  return {
    number: 42,
    title: 'fix: preserve latest review authority',
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    base_ref: 'main',
    head_sha: HEAD_SHA,
    head_repo: 'o/r',
    repository: 'o/r',
    behind_by: 0,
    reviews,
    unresolved_threads: 0,
    workflows: [],
    statuses: [],
  };
}

const policy = {
  default_branch: 'main',
  required_workflows: [],
  required_statuses: [],
  merge_method: 'squash',
};

describe('stale approval ordering', () => {
  it('does not let an older exact-head approval survive a later stale approval by the same actor', () => {
    const result = evaluatePullRequestForMerge(
      pullRequest([
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-09-06T01:00:00Z',
          commit_id: HEAD_SHA,
        },
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-09-06T02:00:00Z',
          commit_id: STALE_SHA,
        },
      ]),
      policy,
    );

    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes('missing-approval'));
  });

  it('allows a later exact-head approval to supersede an earlier stale approval', () => {
    const result = evaluatePullRequestForMerge(
      pullRequest([
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-09-06T01:00:00Z',
          commit_id: STALE_SHA,
        },
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-09-06T02:00:00Z',
          commit_id: HEAD_SHA,
        },
      ]),
      policy,
    );

    assert.deepEqual(result, { eligible: true, blockers: [] });
  });

  it('never lets a later stale approval clear current requested changes', () => {
    const result = evaluatePullRequestForMerge(
      pullRequest([
        {
          actor: 'reviewer-a',
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-09-06T01:00:00Z',
          commit_id: HEAD_SHA,
        },
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-09-06T02:00:00Z',
          commit_id: STALE_SHA,
        },
        {
          actor: 'reviewer-b',
          state: 'APPROVED',
          submitted_at: '2026-09-06T02:30:00Z',
          commit_id: HEAD_SHA,
        },
      ]),
      policy,
    );

    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes('changes-requested'));
  });
});
