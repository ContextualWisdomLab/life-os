import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROVENANCE_STEP_NAME =
  'Materialize AppGuardrail SARIF PR merge provenance';
const EXPECTED_PROVENANCE_RUN = [
  'set -euo pipefail',
  'if ! [[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]]; then',
  '  echo "::error::Pull request number is not a positive integer."',
  '  exit 1',
  'fi',
  'if ! [[ "$EXPECTED_MERGE_SHA" =~ ^[0-9a-f]{40}$ ]]; then',
  '  echo "::error::Advertised pull request merge SHA is not a full commit SHA."',
  '  exit 1',
  'fi',
  '',
  'merge_ref="refs/pull/${PR_NUMBER}/merge"',
  'git fetch --no-tags --depth=1 origin "$merge_ref"',
  'fetched_merge_sha="$(git rev-parse FETCH_HEAD)"',
  'if [ "$fetched_merge_sha" != "$EXPECTED_MERGE_SHA" ]; then',
  '  echo "::error::Fetched pull request merge provenance does not match github.sha."',
  '  exit 1',
  'fi',
  'git cat-file -e "${EXPECTED_MERGE_SHA}^{commit}"',
].join('\n');

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

/** Reads the step's unique direct literal run block without accepting marker-only text. */
function directLiteralRun(step) {
  const lines = step.split('\n');
  const stepMatch = /^(\s*)-\s/u.exec(lines[0]);
  assert.ok(stepMatch, 'workflow step indentation is invalid');
  const directIndent = `${stepMatch[1]}  `;
  const runPrefix = `${directIndent}run:`;
  const matches = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].startsWith(runPrefix)) {
      matches.push(index);
    }
  }
  assert.equal(
    matches.length,
    1,
    'provenance step must own exactly one reviewed direct run authority',
  );

  const runIndex = matches[0];
  assert.equal(
    lines[runIndex],
    `${runPrefix} |`,
    'provenance step must use the reviewed direct literal run authority',
  );
  const bodyIndent = `${directIndent}  `;
  const body = [];
  for (let index = runIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '') {
      body.push('');
      continue;
    }
    if (!line.startsWith(bodyIndent)) {
      break;
    }
    body.push(line.slice(bodyIndent.length));
  }
  while (body.at(-1) === '') {
    body.pop();
  }
  return body.join('\n');
}

/** Requires the provenance shell to remain exactly the reviewed bounded materialization program. */
function assertProvenanceRun(step) {
  assert.equal(
    directLiteralRun(step),
    EXPECTED_PROVENANCE_RUN,
    'provenance step must retain the reviewed direct run authority',
  );
}

test('AppGuardrail provenance owns the reviewed bounded run authority', () => {
  const workflow = readFileSync(
    join(REPOSITORY_ROOT, '.github/workflows/appguardrail.yml'),
    'utf8',
  );
  assert.doesNotThrow(() => assertProvenanceRun(provenanceStep(workflow)));
});

test('provenance run authority treats separator blank lines as outside the reviewed body', () => {
  const validStep = [
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        run: |',
    ...EXPECTED_PROVENANCE_RUN.split('\n').map((line) => `          ${line}`),
    '',
  ].join('\n');

  assert.doesNotThrow(() => assertProvenanceRun(validStep));
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
    '          # git fetch --no-tags --depth=1 origin "$merge_ref"',
    '          # fetched_merge_sha="$(git rev-parse FETCH_HEAD)"',
    '          # git cat-file -e "${EXPECTED_MERGE_SHA}^{commit}"',
    '          echo "provenance materialization skipped"',
  ].join('\n');

  assert.throws(
    () => assertProvenanceRun(hostileStep),
    /reviewed direct run authority/u,
    'comment-only marker text must not satisfy executable provenance authority',
  );
});
