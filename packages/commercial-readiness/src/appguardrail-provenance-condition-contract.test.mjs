import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROVENANCE_STEP_NAME =
  'Materialize AppGuardrail SARIF PR merge provenance';
const PULL_REQUEST_CONDITION = "github.event_name == 'pull_request'";
const SAME_REPOSITORY_CONDITION =
  'github.event.pull_request.head.repo.full_name == github.repository';
const EXPECTED_PROVENANCE_CONDITION = `${PULL_REQUEST_CONDITION} && ${SAME_REPOSITORY_CONDITION}`;

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

  const stepsStart = stepsIndexes[0];
  const directJobMemberIndent = `${jobMatch[1]}  `;
  const stepIndent = `${jobMatch[1]}    `;
  let stepsEnd = lines.length;
  for (let index = stepsStart + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    if (
      line.startsWith(directJobMemberIndent) &&
      !line.startsWith(stepIndent)
    ) {
      stepsEnd = index;
      break;
    }
  }

  const expected = `${stepIndent}- name: ${stepName}`;
  const matches = [];
  for (let index = stepsStart + 1; index < stepsEnd; index += 1) {
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
  let end = stepsEnd;
  for (let index = start + 1; index < stepsEnd; index += 1) {
    if (lines[index].startsWith(`${stepIndent}- `)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Reads one unique direct scalar key from a workflow step and normalizes folded block text. */
function directScalar(step, key) {
  const lines = step.split('\n');
  const stepMatch = /^(\s*)-\s/u.exec(lines[0]);
  assert.ok(stepMatch, 'workflow step indentation is invalid');
  const directIndent = `${stepMatch[1]}  `;
  const prefix = `${directIndent}${key}:`;
  const matches = [];

  for (let index = 1; index < lines.length; index += 1) {
    if (!lines[index].startsWith(prefix)) {
      continue;
    }
    const suffix = lines[index].slice(prefix.length);
    if (suffix.length === 0 || /^\s/u.test(suffix)) {
      matches.push({ index, suffix: suffix.trim() });
    }
  }
  assert.equal(matches.length, 1, `expected exactly one direct ${key} key`);

  const { index, suffix } = matches[0];
  if (!/^[>|][+-]?$/u.test(suffix)) {
    return suffix;
  }

  const body = [];
  for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
    const line = lines[bodyIndex];
    if (line.trim().length === 0) {
      continue;
    }
    const leading = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (leading <= directIndent.length) {
      break;
    }
    body.push(line.trim());
  }
  assert.notEqual(body.length, 0, `direct ${key} block scalar must not be empty`);
  return body.join(' ');
}

/** Requires the provenance restriction to live in the step's direct if key. */
function assertProvenanceGuard(step) {
  assert.equal(
    directScalar(step, 'if'),
    EXPECTED_PROVENANCE_CONDITION,
    'provenance step must require pull_request and same-repository authority in its direct if guard',
  );
}

test('AppGuardrail provenance step owns the exact same-repository pull_request guard', () => {
  const workflow = readFileSync(
    join(REPOSITORY_ROOT, '.github/workflows/appguardrail.yml'),
    'utf8',
  );
  assert.doesNotThrow(() =>
    assertProvenanceGuard(namedStep(workflow, PROVENANCE_STEP_NAME)),
  );
});

test('provenance condition rejects guard strings that exist only outside the if key', () => {
  const hostileStep = [
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        if: always()',
    `        # ${PULL_REQUEST_CONDITION}`,
    '        run: |',
    `          echo "${SAME_REPOSITORY_CONDITION}"`,
  ].join('\n');

  assert.throws(
    () => assertProvenanceGuard(hostileStep),
    /direct if guard/u,
    'comments or run-block text must not satisfy the provenance guard contract',
  );
});

test('provenance condition rejects duplicate direct if authority', () => {
  const hostileStep = [
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        if: >-',
    `          ${PULL_REQUEST_CONDITION}`,
    `          && ${SAME_REPOSITORY_CONDITION}`,
    '        if: always()',
    '        run: echo duplicate-if',
  ].join('\n');

  assert.throws(
    () => assertProvenanceGuard(hostileStep),
    /exactly one direct if key/u,
  );
});

test('provenance step authority rejects step-shaped text inside a run block', () => {
  const hostileWorkflow = [
    'jobs:',
    '  scan:',
    '    steps:',
    '      - name: Harmless generator',
    '        run: |',
    "          cat <<'EOF' > note.yml",
    `          - name: ${PROVENANCE_STEP_NAME}`,
    '            if: >-',
    `              ${PULL_REQUEST_CONDITION}`,
    `              && ${SAME_REPOSITORY_CONDITION}`,
    '            run: echo fake-authority',
    '          EOF',
  ].join('\n');

  assert.throws(
    () =>
      assertProvenanceGuard(namedStep(hostileWorkflow, PROVENANCE_STEP_NAME)),
    /direct workflow step/u,
    'run-block text must not become provenance workflow-step authority',
  );
});

test('provenance condition rejects step-shaped text after the direct steps sequence', () => {
  const hostileWorkflow = [
    'jobs:',
    '  scan:',
    '    steps:',
    '      - name: Harmless scan step',
    '        run: echo scan',
    '    name: |',
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        if: >-',
    `          ${PULL_REQUEST_CONDITION}`,
    `          && ${SAME_REPOSITORY_CONDITION}`,
    '        run: echo fake-authority',
  ].join('\n');

  assert.throws(
    () =>
      assertProvenanceGuard(namedStep(hostileWorkflow, PROVENANCE_STEP_NAME)),
    /direct workflow step/u,
    'job-level mappings after steps must not lend provenance-step authority',
  );
});

test('provenance condition does not borrow authority from quoted or commented sibling jobs', () => {
  for (const sibling of ['  decoy: # sibling', '  "decoy":']) {
    const hostileWorkflow = [
      'jobs:',
      '  scan:',
      sibling,
      '    steps:',
      `      - name: ${PROVENANCE_STEP_NAME}`,
      '        if: >-',
      `          ${PULL_REQUEST_CONDITION}`,
      `          && ${SAME_REPOSITORY_CONDITION}`,
      '        run: echo sibling-authority',
    ].join('\n');

    assert.throws(
      () =>
        assertProvenanceGuard(namedStep(hostileWorkflow, PROVENANCE_STEP_NAME)),
      /direct steps mapping/u,
      'a sibling job must not lend provenance guard authority to jobs.scan',
    );
  }
});
