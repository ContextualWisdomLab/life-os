import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Extracts one direct job only from the workflow's top-level jobs mapping. */
function namedJob(workflow, jobName) {
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
    'workflow must contain exactly one jobs mapping',
  );

  const jobsStart = jobsIndexes[0];
  let jobsEnd = lines.length;
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    if (/^[^\s#]/u.test(lines[index])) {
      jobsEnd = index;
      break;
    }
  }

  const directJobPattern =
    /^  (?:([A-Za-z_][A-Za-z0-9_-]*)|"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'):\s*(?:#.*)?$/u;
  const jobs = [];
  for (let index = jobsStart + 1; index < jobsEnd; index += 1) {
    const match = directJobPattern.exec(lines[index]);
    if (match) {
      jobs.push({ index, name: match[1] ?? match[2] ?? match[3] });
    }
  }

  const matches = jobs.filter(({ name }) => name === jobName);
  assert.equal(matches.length, 1, `expected exactly one workflow job ${jobName}`);
  const start = matches[0].index;
  const position = jobs.findIndex(({ index }) => index === start);
  const end = position + 1 < jobs.length ? jobs[position + 1].index : jobsEnd;
  return lines.slice(start, end);
}

/** Bounds the direct steps sequence of one job. */
function directSteps(jobLines) {
  const jobIndent = /^\s*/u.exec(jobLines[0])?.[0].length ?? 0;
  const keyIndent = jobIndent + 2;
  const stepIndent = keyIndent + 2;
  const stepsLine = `${' '.repeat(keyIndent)}steps:`;
  const indexes = [];
  for (let index = 1; index < jobLines.length; index += 1) {
    if (jobLines[index] === stepsLine) {
      indexes.push(index);
    }
  }
  assert.equal(
    indexes.length,
    1,
    'job must contain exactly one direct steps mapping',
  );

  const lines = [];
  for (let index = indexes[0] + 1; index < jobLines.length; index += 1) {
    const line = jobLines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    const indent = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (indent <= keyIndent) {
      break;
    }
    if (indent === stepIndent && line.startsWith(`${' '.repeat(stepIndent)}- `)) {
      lines.push(line);
    }
  }
  return { lines, stepIndent };
}

/**
 * Requires source-verification workflow steps to expose their authority directly.
 *
 * YAML aliases can replay a previously declared step after raw-text checkout
 * verification has counted the declaration only once, so source-verification
 * jobs must not use step-level YAML anchor/alias indirection.
 */
function assertDirectStepAuthority(workflow, jobName) {
  const { lines } = directSteps(namedJob(workflow, jobName));
  assert.ok(lines.length > 0, `${jobName} must contain direct workflow steps`);
}

const REQUIRED_JOBS = [
  [
    'ci.yml',
    ['compose_runtime', 'today-concurrency', 'validate', 'browser-acceptance'],
  ],
  ['appguardrail.yml', ['scan']],
  ['commercial-readiness.yml', ['audit']],
];

test('source-verification jobs use direct non-aliased step authority', () => {
  for (const [workflowName, jobNames] of REQUIRED_JOBS) {
    const workflow = readFileSync(
      join(REPOSITORY_ROOT, '.github/workflows', workflowName),
      'utf8',
    );
    for (const jobName of jobNames) {
      assertDirectStepAuthority(workflow, jobName);
    }
  }
});

test('source-verification rejects YAML alias replay of a checkout step', () => {
  const hostile = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - &contributor_checkout',
    '        uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    '          ref: ${{ github.event.pull_request.head.sha || github.sha }}',
    '      - *contributor_checkout',
  ].join('\n');

  assert.throws(
    () => assertDirectStepAuthority(hostile, 'validate'),
    /YAML anchor or alias/u,
    'an alias-replayed checkout must not evade exact checkout counting',
  );
});
