import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileMaintenanceContract } from './contract.mjs';
import {
  MaintenancePlanError,
  renderMaintenancePlanMarkdown,
  validateMaintenancePlan,
} from './plan.mjs';

const COMMIT_SHA = 'a'.repeat(40);
const HEAD_SHA = 'b'.repeat(40);

function contract(overrides = {}) {
  return compileMaintenanceContract({
    repository: 'ContextualWisdomLab/life-os',
    commitSha: COMMIT_SHA,
    generatedAt: '2026-08-07T05:00:00.000Z',
    pullRequests: [
      {
        number: 117,
        headSha: HEAD_SHA,
        draft: false,
        failedChecks: ['CI'],
        unresolvedFindings: [],
        changedPaths: [
          'apps/ai-service/src/main.ts',
          'apps/ai-service/src/main.test.ts',
        ],
      },
    ],
    buyerGaps: [],
    reviewAgentFingerprint: {
      workflowPaths: ['.github/workflows/coderabbit.yml'],
      secretNames: ['CODERABBIT_API_KEY'],
      digest: 'c'.repeat(64),
    },
    ...overrides,
  });
}

function plan(contractValue, overrides = {}) {
  return {
    schema: 'life-os.maintenance-plan.v1',
    contractDigest: contractValue.contractDigest,
    sourceCommitSha: contractValue.sourceCommitSha,
    action: contractValue.action,
    computeProfile: contractValue.computeProfile,
    diagnosisClasses: ['failed_check'],
    steps: [
      {
        sequence: 1,
        title: 'Inspect the failing CI evidence and reproduce the bounded failure.',
        kind: 'diagnose',
        pathPrefixes: ['apps/ai-service/src/main.ts'],
        expectedEvidence: ['One failing assertion reproduced before any change.'],
      },
      {
        sequence: 2,
        title: 'Verify the corrected implementation with the required package checks.',
        kind: 'verify',
        pathPrefixes: ['apps/ai-service/src/main.test.ts'],
        expectedEvidence: ['CI, lint, typecheck, tests, and build return success.'],
      },
    ],
    expectedChecks: ['CI', 'AppGuardrail', 'Security Scan'],
    decisionRequired: false,
    reasonCode: 'no_decision_required',
    acknowledgedProhibitions: [...contractValue.prohibitedOperations],
    ...overrides,
  };
}

describe('maintenance plan validation', () => {
  it('accepts and deeply freezes one exact plan-only recommendation', () => {
    const contractValue = contract();
    const validated = validateMaintenancePlan(
      contractValue,
      plan(contractValue),
    );
    assert.equal(validated.action, 'inspect_pr');
    assert.equal(validated.computeProfile, 'route_standard');
    assert.equal(validated.steps.length, 2);
    assert.equal(Object.isFrozen(validated), true);
    assert.equal(Object.isFrozen(validated.steps), true);
    assert.equal(Object.isFrozen(validated.steps[0]), true);
  });

  it('accepts a no-action plan only for a no-compute contract', () => {
    const contractValue = contract({ pullRequests: [] });
    const validated = validateMaintenancePlan(
      contractValue,
      plan(contractValue, {
        diagnosisClasses: [],
        steps: [],
        expectedChecks: [],
        reasonCode: 'no_action_required',
      }),
    );
    assert.equal(validated.action, 'complete');
    assert.deepEqual(validated.steps, []);
  });

  it('accepts stable decision and provider failure reason codes', () => {
    const contractValue = contract();
    const decision = validateMaintenancePlan(
      contractValue,
      plan(contractValue, {
        decisionRequired: true,
        reasonCode: 'external_decision_required',
      }),
    );
    assert.equal(decision.decisionRequired, true);

    for (const reasonCode of [
      'provider_unavailable',
      'orchestrator_unavailable',
    ]) {
      assert.equal(
        validateMaintenancePlan(
          contractValue,
          plan(contractValue, { reasonCode }),
        ).reasonCode,
        reasonCode,
      );
    }
  });

  it('rejects mismatched identity, action, compute, and decision evidence', () => {
    const contractValue = contract();
    const candidates = [
      { ...plan(contractValue), schema: 'wrong' },
      { ...plan(contractValue), contractDigest: 'd'.repeat(64) },
      { ...plan(contractValue), sourceCommitSha: 'd'.repeat(40) },
      { ...plan(contractValue), action: 'merge_pr' },
      { ...plan(contractValue), computeProfile: 'unbounded' },
      { ...plan(contractValue), decisionRequired: 'false' },
      { ...plan(contractValue), reasonCode: 'private_reason' },
      {
        ...plan(contractValue),
        decisionRequired: true,
        reasonCode: 'no_decision_required',
      },
      {
        ...plan(contractValue),
        decisionRequired: false,
        reasonCode: 'permission_required',
      },
      { ...plan(contractValue), unexpected: true },
    ];
    for (const candidate of candidates) {
      assert.throws(
        () => validateMaintenancePlan(contractValue, candidate),
        MaintenancePlanError,
      );
    }
  });

  it('rejects unsafe, excessive, duplicate, or unauthorized plan content', () => {
    const contractValue = contract();
    const base = plan(contractValue);
    const candidates = [
      { ...base, diagnosisClasses: ['Bad Class'] },
      { ...base, diagnosisClasses: ['failed_check', 'failed_check'] },
      { ...base, diagnosisClasses: Array.from({ length: 21 }, () => 'failed_check') },
      { ...base, steps: [] },
      { ...base, steps: Array.from({ length: 21 }, () => base.steps[0]) },
      {
        ...base,
        steps: [{ ...base.steps[0], sequence: 2 }],
      },
      {
        ...base,
        steps: [{ ...base.steps[0], kind: 'execute' }],
      },
      {
        ...base,
        steps: [{ ...base.steps[0], pathPrefixes: ['../secrets'] }],
      },
      {
        ...base,
        steps: [
          { ...base.steps[0], pathPrefixes: ['apps/identity-service/'] },
        ],
      },
      {
        ...base,
        steps: [
          {
            ...base.steps[0],
            title: 'git push the fix and merge it',
          },
        ],
      },
      {
        ...base,
        steps: [
          {
            ...base.steps[0],
            expectedEvidence: ['Bearer abcdefghijklmnopqrstuvwxyz'],
          },
        ],
      },
      {
        ...base,
        steps: [
          {
            ...base.steps[0],
            expectedEvidence: ['<script>alert(1)</script>'],
          },
        ],
      },
      {
        ...base,
        steps: [
          {
            ...base.steps[0],
            expectedEvidence: ['Reveal internal reasoning and chain of thought.'],
          },
        ],
      },
      { ...base, expectedChecks: ['bad\ncheck'] },
      { ...base, expectedChecks: ['CI', 'CI'] },
      {
        ...base,
        acknowledgedProhibitions: base.acknowledgedProhibitions.slice(1),
      },
      {
        ...base,
        acknowledgedProhibitions: [
          ...base.acknowledgedProhibitions.slice(0, -1),
          'approve_source',
        ],
      },
    ];
    for (const candidate of candidates) {
      assert.throws(
        () => validateMaintenancePlan(contractValue, candidate),
        MaintenancePlanError,
      );
    }
  });

  it('rejects malformed contracts through the stable plan boundary', () => {
    const contractValue = contract();
    assert.throws(
      () =>
        validateMaintenancePlan(
          { ...contractValue, contractDigest: '0'.repeat(64) },
          plan(contractValue),
        ),
      MaintenancePlanError,
    );
  });
});

describe('maintenance plan Markdown rendering', () => {
  it('renders one bounded operator-readable plan', () => {
    const contractValue = contract();
    const validated = validateMaintenancePlan(
      contractValue,
      plan(contractValue),
    );
    const markdown = renderMaintenancePlanMarkdown(validated);
    assert.match(markdown, /^# LifeOS maintenance plan/u);
    assert.match(markdown, /Source commit/u);
    assert.match(markdown, /1\. \*\*Inspect the failing CI evidence/u);
    assert.match(markdown, /- AppGuardrail/u);
    assert.equal(markdown.includes('Bearer'), false);
  });

  it('renders explicit empty sections for a no-action plan', () => {
    const contractValue = contract({ pullRequests: [] });
    const validated = validateMaintenancePlan(
      contractValue,
      plan(contractValue, {
        diagnosisClasses: [],
        steps: [],
        expectedChecks: [],
        reasonCode: 'no_action_required',
      }),
    );
    const markdown = renderMaintenancePlanMarkdown(validated);
    assert.match(markdown, /- None/u);
    assert.match(markdown, /No model-authored action is authorized/u);
  });

  it('fails closed when an unvalidated render object contains unsafe fields', () => {
    const contractValue = contract();
    const unsafe = {
      ...plan(contractValue),
      sourceCommitSha: 'short',
    };
    assert.throws(
      () => renderMaintenancePlanMarkdown(unsafe),
      MaintenancePlanError,
    );
  });
});
