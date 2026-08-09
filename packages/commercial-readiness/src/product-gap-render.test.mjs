import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderCommercialReadinessIssue } from './render.mjs';

const marker = '<!-- life-os-commercial-readiness -->';

function report() {
  return {
    schema: 'life-os.commercial-readiness-report.v1',
    generated_at: '2026-08-09T11:00:00.000Z',
    commit_sha: 'a'.repeat(40),
    summary: {
      total_capabilities: 1,
      at_target: 1,
      configured_evidence_gaps: 0,
      open_product_gaps: 1,
      unresolved_gaps: 1,
      weighted_maturity_percent: 100,
    },
    capabilities: [],
    gaps: [],
    product_gaps: [
      {
        capability_id: 'today.action-loop',
        outcome: 'Today remains durable and usable across devices.',
        tracking_issue: 121,
        issue_title: 'Durable Today synchronization remains incomplete',
        priority_score: 215,
      },
    ],
  };
}

describe('commercial readiness product-gap rendering', () => {
  it('separates configured evidence maturity from open registered buyer outcomes', () => {
    const markdown = renderCommercialReadinessIssue(
      report(),
      { pull_requests: [] },
      { marker },
    );

    assert.match(markdown, /Configured evidence gaps: \*\*0\*\*/);
    assert.match(markdown, /Open registered product gaps: \*\*1\*\*/);
    assert.match(markdown, /Unresolved buyer outcomes: \*\*1\*\*/);
    assert.match(markdown, /## Open registered product gaps/);
    assert.match(markdown, /today\.action-loop · score 215/);
    assert.match(markdown, /Tracking: #121/);
    assert.match(
      markdown,
      /Issue: Durable Today synchronization remains incomplete/,
    );
    assert.doesNotMatch(
      markdown,
      /No evidence-backed capability gaps remain at the current target levels\.\n\n## Pull request drain/,
    );
  });
});
