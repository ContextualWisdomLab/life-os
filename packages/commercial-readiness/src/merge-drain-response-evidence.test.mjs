import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeEligiblePullRequests } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const POLICY = Object.freeze({
  default_branch: 'main',
  required_workflows: [],
  required_statuses: [],
  merge_method: 'squash',
});

function eligiblePullRequest() {
  return {
    number: 247,
    title: 'merge response evidence fixture',
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

async function drainWithResponse(response) {
  const candidate = eligiblePullRequest();
  return await mergeEligiblePullRequests({
    repository: 'ContextualWisdomLab/life-os',
    policy: POLICY,
    dryRun: false,
    collectPullRequests: async () => [candidate],
    mergePullRequest: async () => response,
  });
}

describe('merge drain response evidence', () => {
  it('fails closed when a successful mutation response lacks a canonical merge SHA', async () => {
    for (const response of [
      { merged: true },
      { merged: true, sha: 'A'.repeat(40) },
      { merged: 'true', sha: 'b'.repeat(40) },
      null,
    ]) {
      await assert.rejects(
        () => drainWithResponse(response),
        new Error('GitHub merge response was invalid'),
      );
    }
  });

  it('retains one canonical merge SHA after a successful mutation', async () => {
    const mergeSha = 'b'.repeat(40);
    assert.deepEqual(await drainWithResponse({ merged: true, sha: mergeSha }), [
      { number: 247, action: 'merged', merge_sha: mergeSha },
    ]);
  });

  it('keeps an explicit GitHub rejection blocked without inventing a merge SHA', async () => {
    assert.deepEqual(await drainWithResponse({ merged: false }), [
      {
        number: 247,
        action: 'blocked',
        blockers: ['github-rejected-merge'],
      },
    ]);
  });
});
