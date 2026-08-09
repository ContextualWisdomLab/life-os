import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { evaluatePullRequestForMerge } from './pr-gate.mjs';

const HEAD_SHA = 'a'.repeat(40);

function policy(overrides = {}) {
  return {
    default_branch: 'main',
    trusted_author_associations: ['OWNER', 'MEMBER', 'COLLABORATOR'],
    required_workflows: [
      'CI',
      'SAST Semgrep',
      'Security Scan',
      'AppGuardrail',
      'Commercial Readiness',
    ],
    required_statuses: ['CodeRabbit'],
    merge_method: 'squash',
    ...overrides,
  };
}

function pullRequest(overrides = {}) {
  return {
    number: 42,
    title: 'feat: safe change',
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    base_ref: 'main',
    head_sha: HEAD_SHA,
    head_repo: 'ContextualWisdomLab/life-os',
    repository: 'ContextualWisdomLab/life-os',
    author_association: 'MEMBER',
    behind_by: 0,
    reviews: [
      {
        actor: 'reviewer-a',
        state: 'APPROVED',
        submitted_at: '2026-08-03T06:00:00Z',
      },
    ],
    unresolved_threads: 0,
    workflows: [
      {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
        head_sha: HEAD_SHA,
      },
      {
        name: 'SAST Semgrep',
        status: 'completed',
        conclusion: 'success',
        head_sha: HEAD_SHA,
      },
      {
        name: 'Security Scan',
        status: 'completed',
        conclusion: 'success',
        head_sha: HEAD_SHA,
      },
      {
        name: 'AppGuardrail',
        status: 'completed',
        conclusion: 'success',
        head_sha: HEAD_SHA,
      },
      {
        name: 'Commercial Readiness',
        status: 'completed',
        conclusion: 'success',
        head_sha: HEAD_SHA,
      },
    ],
    statuses: [{ context: 'CodeRabbit', state: 'success', sha: HEAD_SHA }],
    ...overrides,
  };
}

describe('evaluatePullRequestForMerge', () => {
  it('accepts only a current same-repository PR with every gate successful', () => {
    assert.deepEqual(evaluatePullRequestForMerge(pullRequest(), policy()), {
      eligible: true,
      blockers: [],
    });
  });

  it('uses repository branch provenance instead of PR-opener association as source trust', () => {
    const candidate = pullRequest({ author_association: 'CONTRIBUTOR' });
    assert.deepEqual(evaluatePullRequestForMerge(candidate, policy()), {
      eligible: true,
      blockers: [],
    });
  });

  it('rejects every unsafe or incomplete merge condition', () => {
    const cases = [
      [pullRequest({ draft: true }), 'draft'],
      [pullRequest({ head_repo: 'fork/life-os' }), 'fork'],
      [
        pullRequest({ mergeable: false, mergeable_state: 'dirty' }),
        'merge-conflict',
      ],
      [
        pullRequest({ mergeable_state: 'behind', behind_by: 1 }),
        'base-out-of-date',
      ],
      [pullRequest({ base_ref: 'develop' }), 'wrong-base'],
      [pullRequest({ unresolved_threads: 1 }), 'unresolved-review-thread'],
      [
        pullRequest({
          reviews: [
            {
              actor: 'reviewer-a',
              state: 'CHANGES_REQUESTED',
              submitted_at: '2026-08-03T06:00:00Z',
            },
          ],
        }),
        'changes-requested',
      ],
      [
        pullRequest({
          workflows: pullRequest().workflows.filter(
            (item) => item.name !== 'AppGuardrail',
          ),
        }),
        'missing-workflow:AppGuardrail',
      ],
      [
        pullRequest({
          workflows: pullRequest().workflows.map((item) =>
            item.name === 'CI'
              ? { ...item, status: 'queued', conclusion: null }
              : item,
          ),
        }),
        'workflow-not-successful:CI',
      ],
      [
        pullRequest({
          workflows: pullRequest().workflows.map((item) =>
            item.name === 'CI'
              ? { ...item, status: 'completed', conclusion: 'cancelled' }
              : item,
          ),
        }),
        'workflow-not-successful:CI',
      ],
      [pullRequest({ statuses: [] }), 'missing-status:CodeRabbit'],
      [
        pullRequest({
          statuses: [
            { context: 'CodeRabbit', state: 'pending', sha: HEAD_SHA },
          ],
        }),
        'status-not-successful:CodeRabbit',
      ],
      [
        pullRequest({
          head_sha: 'b'.repeat(40),
          workflows: pullRequest().workflows,
          statuses: pullRequest().statuses,
        }),
        'stale-check-evidence',
      ],
    ];
    for (const [candidate, blocker] of cases) {
      const result = evaluatePullRequestForMerge(candidate, policy());
      assert.equal(result.eligible, false, blocker);
      assert.ok(
        result.blockers.includes(blocker),
        `${blocker}: ${result.blockers.join(', ')}`,
      );
    }
  });

  it('uses only the latest decisive review per actor', () => {
    const approvedAfterChanges = pullRequest({
      reviews: [
        {
          actor: 'reviewer-a',
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-08-03T05:00:00Z',
        },
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-08-03T06:00:00Z',
        },
      ],
    });
    assert.equal(
      evaluatePullRequestForMerge(approvedAfterChanges, policy()).eligible,
      true,
    );
  });

  it('does not let a non-decisive comment clear requested changes', () => {
    const commentedAfterChanges = pullRequest({
      reviews: [
        {
          actor: 'reviewer-a',
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-08-03T05:00:00Z',
        },
        {
          actor: 'reviewer-a',
          state: 'COMMENTED',
          submitted_at: '2026-08-03T06:00:00Z',
        },
      ],
    });
    const result = evaluatePullRequestForMerge(commentedAfterChanges, policy());
    assert.equal(result.eligible, false);
    assert.ok(result.blockers.includes('changes-requested'));
  });

  it('never treats skipped, neutral, stale, timed-out, or action-required workflows as passing', () => {
    for (const conclusion of [
      'skipped',
      'neutral',
      'stale',
      'timed_out',
      'action_required',
      null,
    ]) {
      const candidate = pullRequest({
        workflows: pullRequest().workflows.map((item) =>
          item.name === 'CI' ? { ...item, conclusion } : item,
        ),
      });
      assert.equal(
        evaluatePullRequestForMerge(candidate, policy()).eligible,
        false,
      );
    }
  });
});
