import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROVENANCE_STEP_NAME =
  'Materialize AppGuardrail SARIF PR merge provenance';
const DIRECT_JOB_ENTRY =
  /^  (?:([A-Za-z_][A-Za-z0-9_-]*)|"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'):\s*(?:#.*)?$/u;
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

/** Returns the canonical job ID for one direct jobs mapping entry. */
function directJobName(line) {
  const match = DIRECT_JOB_ENTRY.exec(line);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

/** Extracts the reviewed provenance step only from the direct scan steps sequence. */
function provenanceStep(workflow) {
  const lines = workflow.split('\n');
  const jobsIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === 'jobs:') {
      jobsIndexes.push(index);
    }
  }
  assert.equal(
    jobsIndexes.length,
    1,
    'workflow must contain exactly one top-level jobs mapping',
  );

  const jobsStart = jobsIndexes[0];
  let jobsEnd = lines.length;
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    if (/^[^\s#]/u.test(lines[index])) {
      jobsEnd = index;
      break;
    }
  }

  const scanIndexes = [];
  for (let index = jobsStart + 1; index < jobsEnd; index += 1) {
    if (directJobName(lines[index]) === 'scan') {
      scanIndexes.push(index);
    }
  }
  assert.equal(scanIndexes.length, 1, 'workflow must contain exactly one jobs.scan');

  const scanStart = scanIndexes[0];
  let scanEnd = jobsEnd;
  for (let index = scanStart + 1; index < jobsEnd; index += 1) {
    if (directJobName(lines[index]) !== null) {
      scanEnd = index;
      break;
    }
  }

  const stepsIndexes = [];
  for (let index = scanStart + 1; index < scanEnd; index += 1) {
    if (lines[index] === '    steps:') {
      stepsIndexes.push(index);
    }
  }
  assert.equal(
    stepsIndexes.length,
    1,
    'jobs.scan must contain exactly one direct steps sequence',
  );

  const stepsStart = stepsIndexes[0];
  let stepsEnd = scanEnd;
  for (let index = stepsStart + 1; index < scanEnd; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    if (line.startsWith('    ') && !line.startsWith('      ')) {
      stepsEnd = index;
      break;
    }
  }

  const expected = `      - name: ${PROVENANCE_STEP_NAME}`;
  const matches = [];
  for (let index = stepsStart + 1; index < stepsEnd; index += 1) {
    if (lines[index] === expected) {
      matches.push(index);
    }
  }
  assert.equal(
    matches.length,
    1,
    'scan must contain the reviewed provenance step exactly once',
  );

  const start = matches[0];
  let end = stepsEnd;
  for (let index = start + 1; index < stepsEnd; index += 1) {
    if (lines[index].startsWith('      - ')) {
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

test('provenance run authority rejects job-level block scalar step impersonation', () => {
  const hostileWorkflow = [
    'name: Hostile workflow',
    'on: workflow_dispatch',
    'jobs:',
    '  scan:',
    '    runs-on: ubuntu-24.04',
    '    steps:',
    '      - name: Harmless scan work',
    '        run: echo harmless',
    '    "name": |',
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        run: |',
    ...EXPECTED_PROVENANCE_RUN.split('\n').map((line) => `          ${line}`),
  ].join('\n');

  assert.throws(
    () => assertProvenanceRun(provenanceStep(hostileWorkflow)),
    /scan must contain the reviewed provenance step/u,
    'job-level scalar payload must not impersonate a direct scan step',
  );
});
