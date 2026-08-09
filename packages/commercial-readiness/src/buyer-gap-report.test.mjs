import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { attachBuyerGapEvidence } from './buyer-gaps.mjs';
import { renderCommercialReadinessIssue } from './render.mjs';

const repositoryRoot = process.env.LIFE_OS_REPOSITORY_ROOT
  ? resolve(process.env.LIFE_OS_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL('../../../', import.meta.url)));

async function repositoryFile(path) {
  return await readFile(resolve(repositoryRoot, path), 'utf8');
}

const baseReport = {
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

const snapshot = {
  pull_requests: [],
};

describe('canonical buyer-gap report', () => {
  it('keeps 100 percent configured maturity separate from an open canonical product gap', () => {
    const report = attachBuyerGapEvidence(baseReport, {
      unresolved: [
        {
          gap_id: 'calendar.per-user-credentials',
          issue_number: 129,
          capability_ids: ['calendar.time-blocking'],
          state: 'open',
          resolution: null,
        },
      ],
      resolved: [],
      unknown: [],
    });

    assert.equal(report.summary.weighted_maturity_percent, 100);
    assert.equal(report.summary.capability_evidence_gaps, 0);
    assert.equal(report.summary.unresolved_buyer_gaps, 1);
    const markdown = renderCommercialReadinessIssue(report, snapshot, {
      marker: '<!-- life-os-commercial-readiness-loop:v1 -->',
      maxGaps: 20,
    });
    assert.match(markdown, /Configured weighted maturity: \*\*100%\*\*/);
    assert.match(markdown, /Capability evidence gaps: \*\*0\*\*/);
    assert.match(markdown, /Unresolved canonical buyer gaps: \*\*1\*\*/);
    assert.match(markdown, /calendar\.per-user-credentials/);
    assert.match(markdown, /#129/);
    assert.doesNotMatch(
      markdown,
      /Unresolved canonical buyer gaps: \*\*0\*\*/,
    );
    assert.doesNotMatch(
      markdown,
      /No registered canonical buyer gaps remain/,
    );
  });

  it('renders unknown canonical issue state explicitly instead of claiming exhaustion', () => {
    const report = attachBuyerGapEvidence(baseReport, {
      unresolved: [],
      resolved: [],
      unknown: [
        {
          gap_id: 'plugins.runtime-delivery',
          issue_number: 130,
          capability_ids: ['integrations.plugin-surface'],
          state: 'unknown',
          resolution: null,
        },
      ],
    });
    const markdown = renderCommercialReadinessIssue(report, snapshot, {
      marker: '<!-- life-os-commercial-readiness-loop:v1 -->',
    });
    assert.match(markdown, /Unknown canonical buyer-gap states: \*\*1\*\*/);
    assert.match(markdown, /state unknown/);
    assert.doesNotMatch(markdown, /No registered canonical buyer gaps remain/);
  });

  it('wires the registry into the live commercial-readiness workflow', async () => {
    const workflow = await repositoryFile(
      '.github/workflows/commercial-readiness.yml',
    );
    assert.match(workflow, /buyer-gap-cli\.mjs/);
    assert.match(workflow, /--buyer-gaps product\/buyer-gaps\.json/);
    assert.match(workflow, /issues:\s*read/);
    assert.match(workflow, /GITHUB_TOKEN:\s*\$\{\{ github\.token \}\}/);
    assert.doesNotMatch(workflow, /secrets:\s*inherit/);
  });
});
