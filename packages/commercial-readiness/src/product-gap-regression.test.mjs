import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { evaluateCapabilities } from './audit.mjs';
import { validateCapabilityManifest } from './schema.mjs';

async function repositoryWithEvidence() {
  const root = await mkdtemp(join(tmpdir(), 'life-os-product-gap-'));
  const path = join(root, 'apps', 'today.ts');
  await mkdir(join(root, 'apps'), { recursive: true });
  await writeFile(path, 'export const today = true;\n', 'utf8');
  return root;
}

function manifest() {
  return validateCapabilityManifest({
    schema: 'life-os.capability-manifest.v1',
    capabilities: [
      {
        id: 'today.action-loop',
        outcome: 'Today remains durable and usable across devices.',
        target_maturity: 'production',
        customer_impact: 5,
        risk: 4,
        acquisition_impact: 5,
        effort: 4,
        dependencies: [],
        tracking_issue: null,
        evidence: [
          {
            maturity: 'production',
            kind: 'implementation',
            mode: 'exists',
            path: 'apps/today.ts',
          },
        ],
      },
    ],
  });
}

const evaluation = {
  generatedAt: '2026-08-09T11:00:00.000Z',
  commitSha: 'a'.repeat(40),
  registeredProductGaps: [
    { capability_id: 'today.action-loop', tracking_issue: 121 },
  ],
};

describe('registered product gap reconciliation', () => {
  it('does not claim whole-product gap exhaustion when target evidence exists but the registered gap is open', async () => {
    const rootDir = await repositoryWithEvidence();
    const report = await evaluateCapabilities(manifest(), {
      ...evaluation,
      rootDir,
      openIssues: [
        {
          number: 121,
          title: 'Durable Today synchronization remains incomplete',
          state: 'open',
          labels: [],
        },
      ],
    });

    assert.equal(report.summary.at_target, 1);
    assert.equal(report.summary.weighted_maturity_percent, 100);
    assert.equal(report.summary.configured_evidence_gaps, 0);
    assert.equal(report.summary.open_product_gaps, 1);
    assert.equal(report.summary.unresolved_gaps, 1);
    assert.equal(report.gaps.length, 0);
    assert.deepEqual(report.product_gaps, [
      {
        capability_id: 'today.action-loop',
        outcome: 'Today remains durable and usable across devices.',
        tracking_issue: 121,
        issue_title: 'Durable Today synchronization remains incomplete',
        priority_score: 215,
      },
    ]);
  });

  it('treats a registered gap as resolved when its canonical issue is absent from the bounded open-issue snapshot', async () => {
    const rootDir = await repositoryWithEvidence();
    const report = await evaluateCapabilities(manifest(), {
      ...evaluation,
      rootDir,
      openIssues: [],
    });

    assert.equal(report.summary.configured_evidence_gaps, 0);
    assert.equal(report.summary.open_product_gaps, 0);
    assert.equal(report.summary.unresolved_gaps, 0);
    assert.deepEqual(report.product_gaps, []);
  });

  it('ignores unrelated duplicate or superseded open issues because only the explicit canonical issue number is policy', async () => {
    const rootDir = await repositoryWithEvidence();
    const report = await evaluateCapabilities(manifest(), {
      ...evaluation,
      rootDir,
      openIssues: [
        {
          number: 999,
          title: 'Duplicate Today report',
          state: 'open',
          labels: ['duplicate'],
        },
      ],
    });

    assert.equal(report.summary.open_product_gaps, 0);
    assert.equal(report.summary.unresolved_gaps, 0);
  });
});
