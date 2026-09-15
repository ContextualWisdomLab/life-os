import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TAG_PROPERTY = /^!(?:!|<[^>]+>|[^\s]+)?(?:\s|$)/u;
const PLAIN_MAPPING = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/u;
const BLOCK_SCALAR = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?(?:\s+#.*)?$/u;

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

/** Bounds every direct sequence item in one job's direct steps mapping. */
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

  const sectionLines = [];
  const sequenceMarker = `${' '.repeat(stepIndent)}-`;
  for (let index = indexes[0] + 1; index < jobLines.length; index += 1) {
    const line = jobLines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      sectionLines.push(line);
      continue;
    }
    const indent = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (indent <= keyIndent) {
      break;
    }
    sectionLines.push(line);
  }

  const starts = [];
  for (let index = 0; index < sectionLines.length; index += 1) {
    const line = sectionLines[index];
    const indent = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (
      indent === stepIndent &&
      (line === sequenceMarker || line.startsWith(`${sequenceMarker} `))
    ) {
      starts.push(index);
    }
  }

  const blocks = starts.map((start, position) => {
    const end =
      position + 1 < starts.length ? starts[position + 1] : sectionLines.length;
    return sectionLines.slice(start, end);
  });
  return { blocks, stepIndent };
}

/** Rejects explicit YAML tag properties from structural step authority. */
function assertNoStructuralYamlTags(stepLines, stepIndent, jobName) {
  const directIndent = stepIndent + 2;
  let blockScalarIndent;

  for (let index = 0; index < stepLines.length; index += 1) {
    const line = stepLines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }

    const indent = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (blockScalarIndent !== undefined) {
      if (indent > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = undefined;
    }

    const structural =
      index === 0
        ? line.slice(stepIndent)
        : indent >= directIndent
          ? line.slice(indent)
          : undefined;
    if (structural === undefined) {
      continue;
    }

    const mappingCandidate = structural.replace(/^-\s+/u, '');
    assert.doesNotMatch(
      mappingCandidate,
      TAG_PROPERTY,
      `${jobName} source-verification structural mapping keys must not use YAML tag authority`,
    );

    const mapping = PLAIN_MAPPING.exec(mappingCandidate);
    if (!mapping) {
      continue;
    }
    const value = mapping[2].trimStart();
    assert.doesNotMatch(
      value,
      TAG_PROPERTY,
      `${jobName} source-verification structural scalar values must not use YAML tag authority`,
    );
    if (BLOCK_SCALAR.test(value)) {
      blockScalarIndent = indent;
    }
  }
}

function assertJobHasNoStructuralYamlTags(workflow, jobName) {
  const { blocks, stepIndent } = directSteps(namedJob(workflow, jobName));
  assert.ok(blocks.length > 0, `${jobName} must contain direct workflow steps`);
  for (const block of blocks) {
    assertNoStructuralYamlTags(block, stepIndent, jobName);
  }
}

const REQUIRED_JOBS = [
  [
    'ci.yml',
    ['compose_runtime', 'today-concurrency', 'validate', 'browser-acceptance'],
  ],
  ['appguardrail.yml', ['scan']],
  ['commercial-readiness.yml', ['audit']],
];

test('source-verification jobs do not use explicit YAML tag authority', () => {
  for (const [workflowName, jobNames] of REQUIRED_JOBS) {
    const workflow = readFileSync(
      join(REPOSITORY_ROOT, '.github/workflows', workflowName),
      'utf8',
    );
    for (const jobName of jobNames) {
      assertJobHasNoStructuralYamlTags(workflow, jobName);
    }
  }
});

test('explicit YAML tag cannot hide checkout authority from source verification', () => {
  const hostile = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    '          ref: reviewed-contributor-sha',
    '      - name: Hidden tagged checkout',
    '        uses: !!str actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    '          ref: refs/heads/main',
  ].join('\n');

  assert.throws(
    () => assertJobHasNoStructuralYamlTags(hostile, 'validate'),
    /structural scalar values must not use YAML tag authority/u,
  );
});

test('explicit YAML tag cannot compose a structural mapping key', () => {
  const hostile = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - name: Hidden tagged key',
    '        !!str uses: actions/checkout@reviewed-sha',
  ].join('\n');

  assert.throws(
    () => assertJobHasNoStructuralYamlTags(hostile, 'validate'),
    /structural mapping keys must not use YAML tag authority/u,
  );
});

test('tag-looking text inside a block scalar is not workflow authority', () => {
  for (const header of ['|2', '>-2', '|+2']) {
    const valid = [
      'jobs:',
      '  validate:',
      '    steps:',
      '      - name: Safe shell',
      `        run: ${header}`,
      '          uses: !!str actions/checkout@not-workflow-authority',
    ].join('\n');

    assert.doesNotThrow(() =>
      assertJobHasNoStructuralYamlTags(valid, 'validate'),
    );
  }
});
