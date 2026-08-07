"""Add focused branch evidence for the maintenance-agent contract package."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "packages/maintenance-agent/src/coverage.test.mjs"


def main() -> None:
    """Write one deterministic branch-coverage test module."""

    TARGET.write_text(
        r'''import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  compileMaintenanceContract,
  contractDigest,
  MaintenanceContractError,
  validateMaintenanceContract,
} from './contract.mjs';
import {
  main as maintenanceMain,
  normalizeMaintenanceEvidence,
} from './cli.mjs';
import {
  MaintenancePlanError,
  renderMaintenancePlanMarkdown,
  validateMaintenancePlan,
} from './plan.mjs';

const COMMIT_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);
const GENERATED_AT = '2026-08-07T06:00:00.000Z';

/** Returns one immutable review-agent fingerprint fixture. */
function fingerprint() {
  return {
    workflowPaths: ['.github/workflows/appguardrail.yml'],
    secretNames: ['NVIDIA_NIM_API_KEY'],
    digest: 'c'.repeat(64),
  };
}

/** Returns one contract input with optional overrides. */
function contractInput(overrides = {}) {
  return {
    repository: 'ContextualWisdomLab/life-os',
    commitSha: COMMIT_SHA,
    generatedAt: GENERATED_AT,
    pullRequests: [],
    buyerGaps: [],
    reviewAgentFingerprint: fingerprint(),
    ...overrides,
  };
}

/** Returns one exact model plan for a compiled contract. */
function plan(contract, overrides = {}) {
  return {
    schema: 'life-os.maintenance-plan.v1',
    contractDigest: contract.contractDigest,
    sourceCommitSha: contract.sourceCommitSha,
    action: contract.action,
    computeProfile: contract.computeProfile,
    diagnosisClasses: contract.action === 'complete' ? [] : ['failed_check'],
    steps:
      contract.action === 'complete'
        ? []
        : [
            {
              sequence: 1,
              title: 'Inspect the bounded maintenance evidence.',
              kind: 'inspect',
              pathPrefixes: [],
              expectedEvidence: ['The evidence is classified without mutation.'],
            },
          ],
    expectedChecks: contract.action === 'complete' ? [] : ['CI'],
    decisionRequired: false,
    reasonCode:
      contract.action === 'complete'
        ? 'no_action_required'
        : 'no_decision_required',
    acknowledgedProhibitions: [...contract.prohibitedOperations],
    ...overrides,
  };
}

/** Returns one bounded snapshot accepted by the maintenance normalizer. */
function snapshot(overrides = {}) {
  return {
    schema: 'life-os.github-snapshot.v1',
    repository: 'ContextualWisdomLab/life-os',
    commit_sha: COMMIT_SHA,
    generated_at: GENERATED_AT,
    truncated: false,
    pull_requests: [],
    issues: [],
    ...overrides,
  };
}

/** Returns one bounded commercial-readiness report fixture. */
function audit(overrides = {}) {
  return {
    schema: 'life-os.commercial-readiness-report.v1',
    generated_at: GENERATED_AT,
    commit_sha: COMMIT_SHA,
    summary: {
      total_capabilities: 1,
      at_target: 1,
      unresolved_gaps: 0,
      weighted_maturity_percent: 100,
    },
    capabilities: [
      {
        id: 'automation.commercial-readiness-loop',
        customer_impact: 5,
        risk: 5,
        acquisition_impact: 5,
        effort: 3,
        evidence: [],
      },
    ],
    gaps: [],
    ...overrides,
  };
}

describe('maintenance uncovered branch evidence', () => {
  it('normalizes absent PR arrays and ignores malformed blocker entries', () => {
    const normalized = normalizeMaintenanceEvidence(
      snapshot({
        pull_requests: [
          {
            number: 7,
            head_sha: HEAD_SHA,
            draft: false,
            unresolved_threads: 0,
            workflows: null,
            statuses: null,
            blockers: [null, '', 42],
          },
        ],
      }),
      audit(),
      fingerprint(),
    );
    assert.deepEqual(normalized.pullRequests[0].failedChecks, []);
    assert.deepEqual(normalized.pullRequests[0].unresolvedFindings, []);
  });

  it('normalizes absent gap evidence collections to an explicit empty boundary', () => {
    const normalized = normalizeMaintenanceEvidence(
      snapshot(),
      audit({
        summary: {
          total_capabilities: 1,
          at_target: 0,
          unresolved_gaps: 1,
          weighted_maturity_percent: 0,
        },
        capabilities: [
          {
            id: 'automation.commercial-readiness-loop',
            customer_impact: 5,
            risk: 5,
            acquisition_impact: 5,
            effort: 3,
            evidence: null,
          },
        ],
        gaps: [
          {
            capability_id: 'automation.commercial-readiness-loop',
            missing_evidence: null,
          },
        ],
      }),
      fingerprint(),
    );
    assert.deepEqual(normalized.buyerGaps[0].allowedPathPrefixes, []);
  });

  it('deterministically orders non-actionable PRs and equal-value buyer gaps', () => {
    const waitContract = compileMaintenanceContract(
      contractInput({
        pullRequests: [
          {
            number: 9,
            headSha: 'd'.repeat(40),
            draft: false,
            failedChecks: [],
            unresolvedFindings: [],
            changedPaths: [],
          },
          {
            number: 8,
            headSha: 'e'.repeat(40),
            draft: false,
            failedChecks: [],
            unresolvedFindings: [],
            changedPaths: [],
          },
        ],
      }),
    );
    assert.equal(waitContract.action, 'wait');
    assert.equal(waitContract.target.number, 8);

    const gapContract = compileMaintenanceContract(
      contractInput({
        buyerGaps: [
          {
            capabilityId: 'zeta.gap',
            customerImpact: 4,
            risk: 4,
            acquisitionImpact: 4,
            effort: 2,
            allowedPathPrefixes: ['zeta/'],
          },
          {
            capabilityId: 'alpha.gap',
            customerImpact: 4,
            risk: 4,
            acquisitionImpact: 4,
            effort: 2,
            allowedPathPrefixes: ['alpha/'],
          },
        ],
      }),
    );
    assert.equal(gapContract.target.capabilityId, 'alpha.gap');
  });

  it('treats high-risk review categories as conducted work without path heuristics', () => {
    const contract = compileMaintenanceContract(
      contractInput({
        pullRequests: [
          {
            number: 7,
            headSha: HEAD_SHA,
            draft: false,
            failedChecks: [],
            unresolvedFindings: [
              {
                source: 'human',
                category: 'security',
                severity: 'medium',
                path: 'README.md',
              },
            ],
            changedPaths: ['README.md'],
          },
        ],
      }),
    );
    assert.equal(contract.computeProfile, 'conduct_bounded');
  });

  it('rejects excessive changed-path evidence after digest verification', () => {
    const contract = compileMaintenanceContract(
      contractInput({
        pullRequests: [
          {
            number: 7,
            headSha: HEAD_SHA,
            draft: false,
            failedChecks: ['CI'],
            unresolvedFindings: [],
            changedPaths: ['README.md'],
          },
        ],
      }),
    );
    const tampered = JSON.parse(JSON.stringify(contract));
    tampered.target.changedPaths = Array.from(
      { length: 33 },
      (_unused, index) => `apps/web/file-${index}.ts`,
    );
    tampered.contractDigest = contractDigest(tampered);
    assert.throws(
      () => validateMaintenanceContract(tampered),
      MaintenanceContractError,
    );
  });

  it('covers plan record, path normalization, generic contract, and render guards', () => {
    const capabilityContract = compileMaintenanceContract(
      contractInput({
        buyerGaps: [
          {
            capabilityId: 'capture.search',
            customerImpact: 5,
            risk: 4,
            acquisitionImpact: 5,
            effort: 3,
            allowedPathPrefixes: ['apps/web/'],
          },
        ],
      }),
    );
    const validated = validateMaintenancePlan(
      capabilityContract,
      plan(capabilityContract, {
        steps: [
          {
            sequence: 1,
            title: 'Inspect the bounded web capability evidence.',
            kind: 'inspect',
            pathPrefixes: ['apps/web'],
            expectedEvidence: ['The capability boundary is identified.'],
          },
        ],
      }),
    );
    assert.deepEqual(validated.steps[0].pathPrefixes, ['apps/web/']);
    assert.throws(
      () => validateMaintenancePlan(capabilityContract, null),
      MaintenancePlanError,
    );

    const sentinel = new Error('generic validation failure');
    const explodingContract = new Proxy(
      {},
      {
        ownKeys() {
          throw sentinel;
        },
      },
    );
    assert.throws(
      () => validateMaintenancePlan(explodingContract, plan(capabilityContract)),
      sentinel,
    );

    assert.throws(
      () => renderMaintenancePlanMarkdown({ ...validated, steps: null }),
      MaintenancePlanError,
    );
    const completeContract = compileMaintenanceContract(contractInput());
    const completePlan = validateMaintenancePlan(
      completeContract,
      plan(completeContract),
    );
    assert.match(
      renderMaintenancePlanMarkdown(completePlan),
      /No model-authored action is authorized/u,
    );
  });

  it('completes the process entry point without changing exit state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life-os-maintenance-main-'));
    const snapshotPath = join(directory, 'snapshot.json');
    const auditPath = join(directory, 'audit.json');
    const fingerprintPath = join(directory, 'fingerprint.json');
    const outputPath = join(directory, 'contract.json');
    const originalExitCode = process.exitCode;
    try {
      await writeFile(snapshotPath, JSON.stringify(snapshot()), 'utf8');
      await writeFile(auditPath, JSON.stringify(audit()), 'utf8');
      await writeFile(fingerprintPath, JSON.stringify(fingerprint()), 'utf8');
      process.exitCode = undefined;
      await maintenanceMain([
        'compile',
        '--snapshot',
        snapshotPath,
        '--audit',
        auditPath,
        '--fingerprint',
        fingerprintPath,
        '--output',
        outputPath,
      ]);
      assert.equal(process.exitCode, undefined);
      assert.equal(
        JSON.parse(await readFile(outputPath, 'utf8')).schema,
        'life-os.maintenance-contract.v1',
      );
    } finally {
      process.exitCode = originalExitCode;
      await rm(directory, { recursive: true, force: true });
    }
  });
});
''',
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
