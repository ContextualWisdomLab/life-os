import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROVENANCE_STEP_NAME =
  'Materialize AppGuardrail SARIF PR merge provenance';
const EXPECTED_PR_NUMBER =
  'PR_NUMBER: ${{ github.event.pull_request.number }}';
const EXPECTED_MERGE_SHA = 'EXPECTED_MERGE_SHA: ${{ github.sha }}';

/** Finds direct jobs while respecting quoted IDs and inline-comment boundaries. */
function directJobEntries(lines, start, end) {
  const entries = [];
  const pattern =
    /^  (?:([A-Za-z_][A-Za-z0-9_-]*)|"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'):\s*(?:#.*)?$/u;
  for (let index = start; index < end; index += 1) {
    const match = pattern.exec(lines[index]);
    if (match) {
      entries.push({ index, name: match[1] ?? match[2] ?? match[3] });
    }
  }
  return entries;
}

/** Extracts one uniquely named direct job from the workflow's top-level jobs mapping. */
function namedJob(workflow, jobName) {
  const lines = workflow.split('\n');
  const jobsIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === 'jobs:') {
      jobsIndexes.push(index);
    }
  }
  assert.equal(jobsIndexes.length, 1, 'workflow must contain exactly one jobs mapping');

  const jobsStart = jobsIndexes[0];
  let jobsEnd = lines.length;
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    if (/^[^\s#]/u.test(lines[index])) {
      jobsEnd = index;
      break;
    }
  }

  const entries = directJobEntries(lines, jobsStart + 1, jobsEnd);
  const matches = entries.filter((entry) => entry.name === jobName);
  assert.equal(matches.length, 1, `expected exactly one workflow job ${jobName}`);

  const start = matches[0].index;
  const position = entries.findIndex((entry) => entry.index === start);
  const end =
    position + 1 < entries.length ? entries[position + 1].index : jobsEnd;
  return lines.slice(start, end).join('\n');
}

/** Extracts one uniquely named real step from the direct steps sequence of jobs.scan. */
function namedStep(workflow, stepName) {
  const scanJob = namedJob(workflow, 'scan');
  const lines = scanJob.split('\n');
  const jobMatch = /^(\s*)scan:\s*$/u.exec(lines[0]);
  assert.ok(jobMatch, 'scan job indentation is invalid');
  const stepsLine = `${jobMatch[1]}  steps:`;
  const stepsIndexes = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === stepsLine) {
      stepsIndexes.push(index);
    }
  }
  assert.equal(
    stepsIndexes.length,
    1,
    'scan job must contain exactly one direct steps mapping',
  );

  const stepIndent = `${jobMatch[1]}    `;
  const expected = `${stepIndent}- name: ${stepName}`;
  const matches = [];
  for (let index = stepsIndexes[0] + 1; index < lines.length; index += 1) {
    if (lines[index] === expected) {
      matches.push(index);
    }
  }
  assert.equal(
    matches.length,
    1,
    `expected exactly one direct workflow step ${stepName}`,
  );

  const start = matches[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith(`${stepIndent}- `)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Extracts one direct child mapping without borrowing sibling keys or block text. */
function directMapping(step, mappingName) {
  const lines = step.split('\n');
  const stepMatch = /^(\s*)-\s/u.exec(lines[0]);
  assert.ok(stepMatch, 'workflow step indentation is invalid');
  const directIndent = `${stepMatch[1]}  `;
  const entryIndent = `${directIndent}  `;
  const mappingLine = `${directIndent}${mappingName}:`;
  const matches = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === mappingLine) {
      matches.push(index);
    }
  }
  assert.equal(
    matches.length,
    1,
    `expected exactly one direct ${mappingName} mapping`,
  );

  const start = matches[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (!lines[index].startsWith(entryIndent)) {
      end = index;
      break;
    }
  }
  return { lines: lines.slice(start, end), entryIndent };
}

/** Requires one unique direct mapping entry with the reviewed exact value. */
function assertUniqueDirectEntry(mapping, key, expectedEntry) {
  const prefix = `${mapping.entryIndent}${key}:`;
  const directEntries = mapping.lines.filter((line) => {
    if (!line.startsWith(prefix)) {
      return false;
    }
    return !line.slice(mapping.entryIndent.length).startsWith(' ');
  });
  assert.equal(
    directEntries.length,
    1,
    `expected exactly one direct ${key} entry`,
  );
  assert.equal(
    directEntries[0],
    `${mapping.entryIndent}${expectedEntry}`,
    `provenance ${key} must use the reviewed GitHub event authority`,
  );
}

/** Requires provenance identity inputs to live in the step's direct env mapping. */
function assertProvenanceEnv(step) {
  const env = directMapping(step, 'env');
  assertUniqueDirectEntry(env, 'PR_NUMBER', EXPECTED_PR_NUMBER);
  assertUniqueDirectEntry(env, 'EXPECTED_MERGE_SHA', EXPECTED_MERGE_SHA);
}

test('AppGuardrail provenance step owns exact pull-request identity through direct env', () => {
  const workflow = readFileSync(
    join(REPOSITORY_ROOT, '.github/workflows/appguardrail.yml'),
    'utf8',
  );
  assert.doesNotThrow(() =>
    assertProvenanceEnv(namedStep(workflow, PROVENANCE_STEP_NAME)),
  );
});

test('provenance env rejects authority markers that exist only outside env', () => {
  const hostileStep = [
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        env:',
    '          HARMLESS: one',
    '        run: |',
    `          # ${EXPECTED_PR_NUMBER}`,
    `          echo '${EXPECTED_MERGE_SHA}'`,
  ].join('\n');

  assert.throws(
    () => assertProvenanceEnv(hostileStep),
    /exactly one direct PR_NUMBER entry/u,
    'comment or run-block markers must not satisfy provenance environment authority',
  );
});

test('provenance env rejects duplicate pull-request identity keys', () => {
  const hostileStep = [
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        env:',
    `          ${EXPECTED_PR_NUMBER}`,
    '          PR_NUMBER: 999',
    `          ${EXPECTED_MERGE_SHA}`,
    '          EXPECTED_MERGE_SHA: deadbeef',
    '        run: echo duplicate-env',
  ].join('\n');

  assert.throws(
    () => assertProvenanceEnv(hostileStep),
    /exactly one direct PR_NUMBER entry/u,
    'duplicate YAML env keys must not override reviewed provenance identity',
  );
});

test('provenance env rejects step-shaped text after the direct steps sequence', () => {
  const hostileWorkflow = [
    'jobs:',
    '  scan:',
    '    steps:',
    '      - name: Harmless scan step',
    '        run: echo scan',
    '    name: |',
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        env:',
    `          ${EXPECTED_PR_NUMBER}`,
    `          ${EXPECTED_MERGE_SHA}`,
    '        run: echo fake-authority',
  ].join('\n');

  assert.throws(
    () => assertProvenanceEnv(namedStep(hostileWorkflow, PROVENANCE_STEP_NAME)),
    /direct workflow step/u,
    'job-level mappings after steps must not lend provenance environment authority',
  );
});

test('provenance env does not borrow identity from quoted or commented sibling jobs', () => {
  for (const sibling of ['  decoy: # sibling', '  "decoy":']) {
    const hostileWorkflow = [
      'jobs:',
      '  scan:',
      sibling,
      '    steps:',
      `      - name: ${PROVENANCE_STEP_NAME}`,
      '        env:',
      `          ${EXPECTED_PR_NUMBER}`,
      `          ${EXPECTED_MERGE_SHA}`,
      '        run: echo sibling-authority',
    ].join('\n');

    assert.throws(
      () => assertProvenanceEnv(namedStep(hostileWorkflow, PROVENANCE_STEP_NAME)),
      /direct steps mapping/u,
      'a sibling job must not lend provenance environment authority to jobs.scan',
    );
  }
});
