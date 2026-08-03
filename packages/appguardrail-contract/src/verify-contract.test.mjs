import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { verifyAppGuardrailContract } from './verify-contract.mjs';

const EXPECTED_FINDING = Object.freeze({
  issue: 16,
  rule_id: 'dangerous-cors',
  severity: 'HIGH',
  context: 'test',
  file: 'tests/appguardrail-fixtures/dangerous-cors.ts'
});

function findingsEnvelope(overrides = {}) {
  return {
    schema: 'appguardrail.findings.v1',
    findings: [
      {
        rule_id: EXPECTED_FINDING.rule_id,
        severity: EXPECTED_FINDING.severity,
        context: EXPECTED_FINDING.context,
        file: EXPECTED_FINDING.file
      }
    ],
    ...overrides
  };
}

function detectorContract(overrides = {}) {
  return {
    schema: 'life-os.appguardrail-contract.v1',
    expected_findings: [{ ...EXPECTED_FINDING }],
    ...overrides
  };
}

describe('verifyAppGuardrailContract', () => {
  it('accepts an exact expected AppGuardrail detection', () => {
    assert.doesNotThrow(() =>
      verifyAppGuardrailContract(findingsEnvelope(), detectorContract())
    );
  });

  it('rejects unsupported or malformed findings envelopes', () => {
    for (const envelope of [
      { schema: 'unknown', findings: [] },
      { schema: 'appguardrail.findings.v1', findings: {} },
      null,
      []
    ]) {
      assert.throws(
        () => verifyAppGuardrailContract(envelope, detectorContract()),
        new Error('Invalid AppGuardrail findings envelope')
      );
    }
  });

  it('rejects unsupported or malformed detector contracts', () => {
    for (const contract of [
      { schema: 'unknown', expected_findings: [] },
      { schema: 'life-os.appguardrail-contract.v1', expected_findings: {} },
      null,
      []
    ]) {
      assert.throws(
        () => verifyAppGuardrailContract(findingsEnvelope(), contract),
        new Error('Invalid AppGuardrail detector contract')
      );
    }
  });

  it('rejects a missing expected detection without echoing evidence', () => {
    assert.throws(
      () =>
        verifyAppGuardrailContract(
          findingsEnvelope({ findings: [] }),
          detectorContract()
        ),
      new Error('Expected AppGuardrail detection is missing')
    );
  });

  it('requires exact severity, context, file, and rule matches', () => {
    const mismatches = [
      { severity: 'WARNING' },
      { context: 'app-code' },
      { file: 'apps/gateway/src/main.ts' },
      { rule_id: 'other-rule' }
    ];

    for (const mismatch of mismatches) {
      const finding = {
        rule_id: EXPECTED_FINDING.rule_id,
        severity: EXPECTED_FINDING.severity,
        context: EXPECTED_FINDING.context,
        file: EXPECTED_FINDING.file,
        ...mismatch
      };
      assert.throws(
        () =>
          verifyAppGuardrailContract(
            findingsEnvelope({ findings: [finding] }),
            detectorContract()
          ),
        new Error('Expected AppGuardrail detection is missing')
      );
    }
  });

  it('rejects duplicate detector contract entries', () => {
    assert.throws(
      () =>
        verifyAppGuardrailContract(
          findingsEnvelope(),
          detectorContract({
            expected_findings: [
              { ...EXPECTED_FINDING },
              { ...EXPECTED_FINDING }
            ]
          })
        ),
      new Error('Duplicate AppGuardrail detector contract entry')
    );
  });

  it('rejects invalid issue identifiers and required string fields', () => {
    const invalidEntries = [
      { ...EXPECTED_FINDING, issue: 0 },
      { ...EXPECTED_FINDING, issue: -1 },
      { ...EXPECTED_FINDING, issue: 1.5 },
      { ...EXPECTED_FINDING, issue: '16' },
      { ...EXPECTED_FINDING, rule_id: '   ' },
      { ...EXPECTED_FINDING, severity: null },
      { ...EXPECTED_FINDING, context: '' },
      { ...EXPECTED_FINDING, file: 42 },
      null
    ];

    for (const entry of invalidEntries) {
      assert.throws(
        () =>
          verifyAppGuardrailContract(
            findingsEnvelope(),
            detectorContract({ expected_findings: [entry] })
          ),
        new Error('Invalid AppGuardrail detector contract')
      );
    }
  });

  it('rejects malformed finding entries without exposing their contents', () => {
    const invalidFindings = [
      null,
      { rule_id: '', severity: 'HIGH', context: 'test', file: 'fixture.ts' },
      { rule_id: 'dangerous-cors', severity: 7, context: 'test', file: 'fixture.ts' },
      { rule_id: 'dangerous-cors', severity: 'HIGH', context: [], file: 'fixture.ts' },
      { rule_id: 'dangerous-cors', severity: 'HIGH', context: 'test', file: null }
    ];

    for (const finding of invalidFindings) {
      assert.throws(
        () =>
          verifyAppGuardrailContract(
            findingsEnvelope({ findings: [finding] }),
            detectorContract()
          ),
        new Error('Invalid AppGuardrail findings envelope')
      );
    }
  });
});
