import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  attachBuyerGapEvidence,
  validateBuyerGapSnapshot,
} from './buyer-gaps.mjs';

function snapshot(overrides = {}) {
  return {
    schema: 'life-os.commercial-buyer-gap-snapshot.v1',
    repository: 'ContextualWisdomLab/life-os',
    generated_at: '2026-08-09T11:00:00.000Z',
    issues: [
      {
        number: 55,
        state: 'closed',
        state_reason: 'completed',
        labels: [],
      },
    ],
    ...overrides,
  };
}

describe('validateBuyerGapSnapshot', () => {
  it('accepts and freezes a minimal external issue-state projection', () => {
    const value = validateBuyerGapSnapshot(snapshot());
    assert.equal(value.repository, 'ContextualWisdomLab/life-os');
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.isFrozen(value.issues), true);
    assert.equal(Object.isFrozen(value.issues[0].labels), true);
  });

  it('rejects raw bodies, duplicate evidence, malformed repositories, and oversized collections', () => {
    const issue = snapshot().issues[0];
    const invalid = [
      snapshot({ repository: 'https://example.test/repo' }),
      snapshot({ issues: [{ ...issue, body: 'untrusted' }] }),
      snapshot({ issues: [issue, issue] }),
      snapshot({ issues: Array.from({ length: 101 }, (_, index) => ({
        number: index + 1,
        state: 'open',
        state_reason: null,
        labels: [],
      })) }),
      snapshot({
        issues: [
          {
            number: 55,
            state: 'open',
            state_reason: null,
            labels: ['unsafe\nlabel'],
          },
        ],
      }),
    ];
    for (const value of invalid) {
      assert.throws(
        () => validateBuyerGapSnapshot(value),
        /Invalid buyer gap snapshot/,
      );
    }
  });
});

describe('attachBuyerGapEvidence', () => {
  it('preserves configured capability maturity while adding explicit product-gap dimensions', () => {
    const report = {
      schema: 'life-os.commercial-readiness-report.v1',
      generated_at: '2026-08-09T11:00:00.000Z',
      commit_sha: 'a'.repeat(40),
      summary: {
        total_capabilities: 22,
        at_target: 22,
        unresolved_gaps: 0,
        weighted_maturity_percent: 100,
      },
      capabilities: [],
      gaps: [],
    };
    const result = attachBuyerGapEvidence(report, {
      unresolved: [
        {
          gap_id: 'data.portability-completion',
          issue_number: 55,
          capability_ids: ['data.portability-rights'],
          state: 'open',
          resolution: null,
        },
      ],
      resolved: [],
      unknown: [],
    });

    assert.equal(result.summary.weighted_maturity_percent, 100);
    assert.equal(result.summary.unresolved_gaps, 0);
    assert.equal(result.summary.capability_evidence_gaps, 0);
    assert.equal(result.summary.unresolved_buyer_gaps, 1);
    assert.equal(result.summary.unknown_buyer_gap_states, 0);
    assert.equal(result.buyer_gaps[0].issue_number, 55);
  });
});
