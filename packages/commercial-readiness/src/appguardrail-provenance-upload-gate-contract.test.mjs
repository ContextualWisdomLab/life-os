import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROVENANCE_STEP_NAME =
  'Materialize AppGuardrail SARIF PR merge provenance';
const UPLOAD_STEP_NAME = 'Upload AppGuardrail SARIF to code scanning';
const PROVENANCE_STEP_ID = 'materialize_pr_provenance';
const DIRECT_JOB_ENTRY =
  /^  (?:([A-Za-z_][A-Za-z0-9_-]*)|"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'):\s*(?:#.*)?$/u;
const EXPECTED_UPLOAD_CONDITION = [
  'always()',
  "&& hashFiles('appguardrail.sarif') != ''",
  "&& (github.event_name != 'pull_request'",
  '|| (github.event.pull_request.head.repo.full_name == github.repository',
  `&& steps.${PROVENANCE_STEP_ID}.outcome == 'success'))`,
].join(' ');

/** Returns the canonical job ID for one direct jobs mapping entry. */
function directJobName(line) {
  const match = DIRECT_JOB_ENTRY.exec(line);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

/** Extracts one uniquely named step from the direct jobs.scan steps sequence. */
function namedScanStep(workflow, stepName) {
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

  const jobs = [];
  for (let index = jobsStart + 1; index < jobsEnd; index += 1) {
    const name = directJobName(lines[index]);
    if (name !== null) {
      jobs.push({ index, name });
    }
  }
  const scanMatches = jobs.filter(({ name }) => name === 'scan');
  assert.equal(scanMatches.length, 1, 'workflow must contain exactly one jobs.scan');

  const scanStart = scanMatches[0].index;
  const scanPosition = jobs.findIndex(({ index }) => index === scanStart);
  const scanEnd =
    scanPosition + 1 < jobs.length ? jobs[scanPosition + 1].index : jobsEnd;

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

  const expected = `      - name: ${stepName}`;
  const matches = [];
  for (let index = stepsStart + 1; index < stepsEnd; index += 1) {
    if (lines[index] === expected) {
      matches.push(index);
    }
  }
  assert.equal(matches.length, 1, `scan must contain exactly one ${stepName} step`);

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

/** Reads one unique direct plain scalar from a step. */
function directPlainScalar(step, key) {
  const lines = step.split('\n');
  const prefix = `        ${key}:`;
  const matches = lines
    .slice(1)
    .filter((line) => line.startsWith(prefix));
  assert.equal(matches.length, 1, `step must contain exactly one direct ${key} key`);
  const line = matches[0];
  assert.match(line, new RegExp(`^        ${key}: [A-Za-z_][A-Za-z0-9_-]*$`, 'u'));
  return line.slice(prefix.length).trim();
}

/** Reads one unique direct folded if scalar without borrowing marker text from other keys. */
function directFoldedIf(step) {
  const lines = step.split('\n');
  const matches = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].startsWith('        if:')) {
      matches.push(index);
    }
  }
  assert.equal(matches.length, 1, 'step must contain exactly one direct if key');

  const index = matches[0];
  assert.equal(lines[index], '        if: >-', 'upload step must use the reviewed folded if scalar');
  const parts = [];
  for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor];
    if (line === '') {
      continue;
    }
    if (!line.startsWith('          ')) {
      break;
    }
    parts.push(line.trim());
  }
  return parts.join(' ');
}

test('AppGuardrail SARIF upload is fail-closed on PR provenance materialization', () => {
  const workflow = readFileSync(
    join(REPOSITORY_ROOT, '.github/workflows/appguardrail.yml'),
    'utf8',
  );
  const provenance = namedScanStep(workflow, PROVENANCE_STEP_NAME);
  const upload = namedScanStep(workflow, UPLOAD_STEP_NAME);

  assert.equal(
    directPlainScalar(provenance, 'id'),
    PROVENANCE_STEP_ID,
    'provenance materialization must publish the reviewed step outcome authority',
  );
  assert.equal(
    directFoldedIf(upload),
    EXPECTED_UPLOAD_CONDITION,
    'same-repository PR SARIF upload must require successful provenance materialization',
  );
});
