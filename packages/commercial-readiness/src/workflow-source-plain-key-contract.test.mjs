import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PLAIN_MAPPING = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/u;
const QUOTED_MAPPING_KEY =
  /^(?:"(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:/u;
const EXPLICIT_MAPPING_KEY = /^\?\s/u;
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

/**
 * Keeps structural workflow authority in the plain-key form consumed by the
 * source-verification scanners while leaving quoted scalar values unrestricted.
 */
function assertPlainStructuralKeys(stepLines, stepIndent, jobName) {
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
      QUOTED_MAPPING_KEY,
      `${jobName} source-verification structural mapping keys must use canonical plain identifiers`,
    );
    assert.doesNotMatch(
      mappingCandidate,
      EXPLICIT_MAPPING_KEY,
      `${jobName} source-verification structural mapping keys must use canonical plain identifiers`,
    );

    const mapping = PLAIN_MAPPING.exec(mappingCandidate);
    if (!mapping) {
      continue;
    }
    if (BLOCK_SCALAR.test(mapping[2].trimStart())) {
      blockScalarIndent = indent;
    }
  }
}

function assertJobUsesPlainStructuralKeys(workflow, jobName) {
  const { blocks, stepIndent } = directSteps(namedJob(workflow, jobName));
  assert.ok(blocks.length > 0, `${jobName} must contain direct workflow steps`);
  for (const block of blocks) {
    assertPlainStructuralKeys(block, stepIndent, jobName);
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

test('source-verification jobs expose structural authority through plain mapping keys', () => {
  for (const [workflowName, jobNames] of REQUIRED_JOBS) {
    const workflow = readFileSync(
      join(REPOSITORY_ROOT, '.github/workflows', workflowName),
      'utf8',
    );
    for (const jobName of jobNames) {
      assertJobUsesPlainStructuralKeys(workflow, jobName);
    }
  }
});

test('source verification rejects quoted structural keys that can hide a second checkout', () => {
  for (const quotedUses of [
    '"uses": actions/checkout@reviewed-sha',
    "'uses': actions/checkout@reviewed-sha",
  ]) {
    const hostile = [
      'jobs:',
      '  validate:',
      '    steps:',
      '      - uses: actions/checkout@reviewed-sha',
      '        with:',
      '          persist-credentials: false',
      '          ref: ${{ github.event.pull_request.head.sha || github.sha }}',
      '      - name: Hidden second checkout',
      `        ${quotedUses}`,
      '        with:',
      '          persist-credentials: false',
      '          ref: refs/heads/main',
    ].join('\n');

    assert.throws(
      () => assertJobUsesPlainStructuralKeys(hostile, 'validate'),
      /structural mapping keys must use canonical plain identifiers/u,
      'quoted structural keys must not hide executable checkout authority from source verification',
    );
  }
});

test('source verification rejects explicit mapping-key syntax that can hide a second checkout', () => {
  const hostile = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    '          ref: ${{ github.event.pull_request.head.sha || github.sha }}',
    '      - name: Hidden second checkout',
    '        ? uses',
    '        : actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    '          ref: refs/heads/main',
  ].join('\n');

  assert.throws(
    () => assertJobUsesPlainStructuralKeys(hostile, 'validate'),
    /structural mapping keys must use canonical plain identifiers/u,
    'explicit mapping-key syntax must not hide executable checkout authority from source verification',
  );
});

test('quoted mapping-looking text inside a block scalar is not workflow authority', () => {
  const valid = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - name: Safe shell',
    '        run: |2',
    '          "uses": actions/checkout@not-workflow-authority',
  ].join('\n');

  assert.doesNotThrow(() => assertJobUsesPlainStructuralKeys(valid, 'validate'));
});
