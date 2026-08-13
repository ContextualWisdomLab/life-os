import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const canonical = [
  'ARCHITECTURE.md',
  'docs/PRD.md',
  'docs/TRD.md',
  'docs/DATA_MODEL.md',
  'docs/API_CONTRACTS.md',
  'docs/UML.md',
  'docs/THREAT_MODEL.md',
  'docs/PRIVACY_DATA_LIFECYCLE.md',
  'docs/TRACEABILITY.md',
  'docs/DOCUMENTATION_ASSESSMENT.md',
].map(read).join('\n');
const traceability = read('docs/TRACEABILITY.md');
const assessment = read('docs/DOCUMENTATION_ASSESSMENT.md');

/** Requires one exact current-active pull-request row with the requested maturity. */
function assertActiveAssessmentRow(pullRequest, status = 'Implemented on active PR') {
  const prefix = `| PR #${pullRequest} |`;
  const row = assessment.split('\n').find((line) => line.startsWith(prefix));
  assert.ok(row, `missing active assessment row for PR #${pullRequest}`);
  assert.match(row, new RegExp(`\\| ${status} \\|`, 'u'));
}

/** Requires protected-main reconciliation on the same bounded line as the PR identity. */
function assertProtectedAssessmentEvidence(pullRequest) {
  assert.match(
    assessment,
    new RegExp(`^[-|].*PR #${pullRequest}\\b[^\\n]*Implemented on protected main`, 'mu'),
  );
}

test('canonical maturity follows protected main and current active work', () => {
  for (const pullRequest of [
    157, 159, 168, 169, 172, 173, 175, 176, 179, 184, 185, 186,
    187, 188, 189, 190, 191, 192, 193, 194, 195, 196, 197, 200, 201, 203,
  ]) {
    assert.match(canonical, new RegExp(`PR #${pullRequest}\\b`, 'u'));
  }

  for (const requirement of [
    'PRD-PLAN-003', 'PRD-HAB-002', 'PRD-REV-002', 'PRD-CAL-007',
    'PRD-CAL-008', 'PRD-PRIV-007', 'PRD-PRIV-008', 'PRD-INT-004',
    'PRD-INT-005', 'PRD-INT-006', 'PRD-WEB-002',
  ]) {
    assert.match(
      traceability,
      new RegExp(`${requirement}.*Implemented on protected main`, 'u'),
    );
  }

  for (const pullRequest of [145, 198, 199, 204, 205]) {
    assertActiveAssessmentRow(pullRequest);
  }
  for (const pullRequest of [154, 155, 156, 195, 200, 203]) {
    assertProtectedAssessmentEvidence(pullRequest);
  }

  assert.doesNotMatch(
    canonical,
    /PR #(?:156|160|162|165|175|176|178|179|195|200|203) (?:is \*\*Implemented on active PR\*\*|\| Implemented on active PR \|)/iu,
  );
  assert.match(canonical, /Issue #163.*completed/iu);
});

test('canonical gaps remain bounded and truthful', () => {
  assert.match(traceability, /Canonical buyer gaps remain #55, #129 and #130/u);
  assert.match(assessment, /Issue #132.*Partial/su);
  assert.match(assessment, /PR #205[^\n]*host-owned delivery-origin authority foundation/iu);
  assert.match(assessment, /PR #204[^\n]*read-only Actions workflow-registry detector/iu);
});
