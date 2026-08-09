import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { evaluateCapabilities } from './audit.mjs';

const manifest = {
  capabilities: [
    {
      id: 'planning.durable-data',
      outcome: 'Durable planning works.',
      target_maturity: 'production',
      customer_impact: 5,
      risk: 5,
      acquisition_impact: 5,
      effort: 1,
      dependencies: [],
      tracking_issue: 121,
      evidence: [
        {
          maturity: 'production',
          mode: 'contains',
          path: 'evidence.txt',
          value: 'durable',
          max_bytes: 1024,
        },
      ],
    },
  ],
};

async function evaluate(rootDir, buyerGapEvidence) {
  return await evaluateCapabilities(manifest, {
    rootDir,
    generatedAt: '2026-08-09T11:00:00.000Z',
    commitSha: 'a'.repeat(40),
    buyerGapEvidence,
  });
}

describe('evaluateCapabilities with canonical buyer-gap evidence', () => {
  it('keeps the configured maturity result byte-for-byte equivalent while adding dimensions', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'life-os-buyer-gap-audit-'));
    await writeFile(join(rootDir, 'evidence.txt'), 'durable', 'utf8');

    const legacy = await evaluate(rootDir, undefined);
    const enriched = await evaluate(rootDir, {
      unresolved: [
        {
          gap_id: 'today.multi-device-sync',
          issue_number: 121,
          capability_ids: ['planning.durable-data'],
          state: 'open',
          resolution: null,
        },
      ],
      resolved: [],
      unknown: [],
    });

    assert.deepEqual(enriched.capabilities, legacy.capabilities);
    assert.deepEqual(enriched.gaps, legacy.gaps);
    assert.equal(
      enriched.summary.weighted_maturity_percent,
      legacy.summary.weighted_maturity_percent,
    );
    assert.equal(enriched.summary.unresolved_gaps, legacy.summary.unresolved_gaps);
    assert.equal(enriched.summary.capability_evidence_gaps, 0);
    assert.equal(enriched.summary.unresolved_buyer_gaps, 1);
    assert.equal(enriched.summary.unknown_buyer_gap_states, 0);
  });
});
