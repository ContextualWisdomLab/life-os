import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROVENANCE_STEP_NAME =
  'Materialize AppGuardrail SARIF PR merge provenance';
const FETCH_COMMAND = 'git fetch --no-tags --depth=1 origin "$merge_ref"';
const REV_PARSE_COMMAND = 'git rev-parse FETCH_HEAD';
const CAT_FILE_COMMAND = 'git cat-file -e "${EXPECTED_MERGE_SHA}^{commit}"';

/** Extracts the reviewed provenance step from the direct scan steps sequence. */
function provenanceStep(workflow) {
  const lines = workflow.split('\n');
  const jobsIndex = lines.indexOf('jobs:');
  assert.notEqual(jobsIndex, -1, 'workflow must contain jobs');
  const scanIndex = lines.indexOf('  scan:', jobsIndex + 1);
  assert.notEqual(scanIndex, -1, 'workflow must contain jobs.scan');
  const stepsIndex = lines.indexOf('    steps:', scanIndex + 1);
  assert.notEqual(stepsIndex, -1, 'jobs.scan must contain direct steps');

  const expected = `      - name: ${PROVENANCE_STEP_NAME}`;
  const start = lines.indexOf(expected, stepsIndex + 1);
  assert.notEqual(start, -1, 'scan must contain the reviewed provenance step');
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('      - ')) {
      end = index;
      break;
    }
    if (/^    [A-Za-z_][A-Za-z0-9_-]*:/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/**
 * Mirrors the current aggregate verifier's provenance-run assertions.
 * The hostile regression below proves this text-presence model is insufficient.
 */
function assertProvenanceRun(step) {
  assert.ok(step.includes(FETCH_COMMAND), 'provenance must fetch the bounded merge ref');
  assert.ok(step.includes(REV_PARSE_COMMAND), 'provenance must inspect FETCH_HEAD');
  assert.ok(step.includes(CAT_FILE_COMMAND), 'provenance must materialize the merge commit');
  assert.equal(step.includes('fetch-depth: 0'), false, 'provenance must stay shallow');
  assert.equal(step.includes('git checkout'), false, 'provenance must not replace the contributor checkout');
}

test('AppGuardrail provenance owns the reviewed bounded run authority', () => {
  const workflow = readFileSync(
    join(REPOSITORY_ROOT, '.github/workflows/appguardrail.yml'),
    'utf8',
  );
  assert.doesNotThrow(() => assertProvenanceRun(provenanceStep(workflow)));
});

test('provenance run authority rejects marker text that exists only in shell comments', () => {
  const hostileStep = [
    `      - name: ${PROVENANCE_STEP_NAME}`,
    "        if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository",
    '        env:',
    '          PR_NUMBER: ${{ github.event.pull_request.number }}',
    '          EXPECTED_MERGE_SHA: ${{ github.sha }}',
    '        run: |',
    '          set -euo pipefail',
    `          # ${FETCH_COMMAND}`,
    `          # fetched_merge_sha="$(${REV_PARSE_COMMAND})"`,
    `          # ${CAT_FILE_COMMAND}`,
    '          echo "provenance materialization skipped"',
  ].join('\n');

  assert.throws(
    () => assertProvenanceRun(hostileStep),
    /reviewed direct run authority/u,
    'comment-only marker text must not satisfy executable provenance authority',
  );
});
