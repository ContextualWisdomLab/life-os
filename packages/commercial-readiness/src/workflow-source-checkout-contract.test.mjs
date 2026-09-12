import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SELF_REPOSITORY = 'ContextualWisdomLab/life-os';
const SOURCE_REF =
  'ref: ${{ github.event.pull_request.head.sha || github.sha }}';

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

/** Extracts one direct job only from the top-level jobs mapping. */
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

  const entries = directJobEntries(lines, jobsStart + 1, jobsEnd);
  const matches = entries.filter((entry) => entry.name === jobName);
  assert.equal(
    matches.length,
    1,
    `expected exactly one workflow job ${jobName}`,
  );
  const start = matches[0].index;
  const position = entries.findIndex((entry) => entry.index === start);
  const end =
    position + 1 < entries.length ? entries[position + 1].index : jobsEnd;
  return lines.slice(start, end).join('\n');
}

/** Bounds the direct steps sequence without accepting later job-level mappings. */
function stepsSection(job) {
  const lines = job.split('\n');
  const jobIndent = /^\s*/u.exec(lines[0])?.[0] ?? '';
  const keyIndent = `${jobIndent}  `;
  const stepsLine = `${keyIndent}steps:`;
  const indexes = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === stepsLine) {
      indexes.push(index);
    }
  }
  assert.equal(
    indexes.length,
    1,
    'job must contain exactly one direct steps mapping',
  );

  const start = indexes[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    const indent = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (indent <= keyIndent.length) {
      end = index;
      break;
    }
  }
  return { lines: lines.slice(start, end), stepIndent: `${keyIndent}  ` };
}

/** Returns real direct workflow-step blocks from one already bounded job. */
function stepBlocks(job) {
  const section = stepsSection(job);
  const starts = [];
  for (let index = 0; index < section.lines.length; index += 1) {
    if (section.lines[index].startsWith(`${section.stepIndent}- `)) {
      starts.push(index);
    }
  }
  return starts.map((start, position) => {
    const end =
      position + 1 < starts.length
        ? starts[position + 1]
        : section.lines.length;
    return section.lines.slice(start, end);
  });
}

/** Reads one unique direct scalar, including an inline key on the sequence item. */
function directStepScalar(stepLines, key, stepIndent) {
  const directIndent = `${stepIndent}  `;
  const directPrefix = `${directIndent}${key}:`;
  const inlinePrefix = `${stepIndent}- ${key}:`;
  const values = [];
  if (stepLines[0]?.startsWith(inlinePrefix)) {
    values.push(stepLines[0].slice(inlinePrefix.length).trim());
  }
  for (const line of stepLines.slice(1)) {
    if (line.startsWith(directPrefix)) {
      values.push(line.slice(directPrefix.length).trim());
    }
  }
  assert.ok(values.length <= 1, `step must not duplicate direct ${key}`);
  return values[0];
}

/** Reads direct with inputs without borrowing nested or sibling text. */
function directWithEntries(stepLines, stepIndent) {
  const directIndent = `${stepIndent}  `;
  const entryIndent = `${directIndent}  `;
  const mappingLine = `${directIndent}with:`;
  const indexes = [];
  for (let index = 1; index < stepLines.length; index += 1) {
    if (stepLines[index] === mappingLine) {
      indexes.push(index);
    }
  }
  if (indexes.length === 0) {
    return [];
  }
  assert.equal(
    indexes.length,
    1,
    'checkout step must not duplicate direct with mapping',
  );

  const entries = [];
  for (let index = indexes[0] + 1; index < stepLines.length; index += 1) {
    const line = stepLines[index];
    if (!line.startsWith(entryIndent)) {
      break;
    }
    if (!line.slice(entryIndent.length).startsWith(' ')) {
      entries.push(line.trim());
    }
  }
  return entries;
}

/** Classifies checkout repository authority without accepting dynamic ambiguity. */
function checkoutRepositoryKind(entries) {
  const repositories = entries.filter((entry) => entry.startsWith('repository:'));
  assert.ok(
    repositories.length <= 1,
    'checkout step must not duplicate direct repository authority',
  );
  if (repositories.length === 0) {
    return 'self';
  }

  let repository = repositories[0].slice('repository:'.length).trim();
  if (
    (repository.startsWith('"') && repository.endsWith('"')) ||
    (repository.startsWith("'") && repository.endsWith("'"))
  ) {
    repository = repository.slice(1, -1);
  }
  if (repository === SELF_REPOSITORY || repository === '${{ github.repository }}') {
    return 'self';
  }
  assert.match(
    repository,
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
    'external checkout repository authority must be one static owner/name',
  );
  return 'external';
}

/** Requires one exact self checkout while allowing explicit static external dependencies. */
function assertExactContributorCheckout(workflow, jobName) {
  const job = namedJob(workflow, jobName);
  const section = stepsSection(job);
  const selfCheckouts = [];

  for (const step of stepBlocks(job)) {
    const uses = directStepScalar(step, 'uses', section.stepIndent);
    if (!uses?.startsWith('actions/checkout@')) {
      continue;
    }
    const entries = directWithEntries(step, section.stepIndent);
    if (checkoutRepositoryKind(entries) === 'self') {
      selfCheckouts.push(entries);
    }
  }

  assert.equal(
    selfCheckouts.length,
    1,
    `${jobName} must own exactly one current-repository checkout`,
  );
  assert.deepEqual(
    selfCheckouts[0].filter((entry) => entry.startsWith('ref:')),
    [SOURCE_REF],
    `${jobName} current-repository checkout must bind exactly to the contributor head`,
  );
  assert.deepEqual(
    selfCheckouts[0].filter((entry) => entry.startsWith('persist-credentials:')),
    ['persist-credentials: false'],
    `${jobName} contributor checkout must disable credential persistence exactly once`,
  );
}

const REQUIRED_JOBS = [
  [
    'ci.yml',
    ['compose_runtime', 'today-concurrency', 'validate', 'browser-acceptance'],
  ],
  ['appguardrail.yml', ['scan']],
  ['commercial-readiness.yml', ['audit']],
];

test('source-verification jobs own direct exact contributor checkouts', () => {
  for (const [workflowName, jobNames] of REQUIRED_JOBS) {
    const workflow = readFileSync(
      join(REPOSITORY_ROOT, '.github/workflows', workflowName),
      'utf8',
    );
    for (const jobName of jobNames) {
      assertExactContributorCheckout(workflow, jobName);
    }
  }
});

test('job extraction rejects checkout evidence borrowed from an inline-comment sibling', () => {
  const hostile = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - name: Checkout without reviewed ref',
    '        uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    '  decoy: # valid sibling job boundary',
    '    steps:',
    '      - name: Decoy checkout',
    '        uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    `          ${SOURCE_REF}`,
  ].join('\n');

  assert.throws(
    () => assertExactContributorCheckout(hostile, 'validate'),
    /current-repository checkout must bind exactly to the contributor head/u,
  );
});

test('checkout source binding rejects duplicate direct ref authority', () => {
  const hostile = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    `          ${SOURCE_REF}`,
    '          ref: refs/pull/123/merge',
  ].join('\n');

  assert.throws(
    () => assertExactContributorCheckout(hostile, 'validate'),
    /current-repository checkout must bind exactly to the contributor head/u,
  );
});

test('checkout source binding rejects a later current-repository checkout', () => {
  const hostile = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    `          ${SOURCE_REF}`,
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    '          ref: refs/heads/main',
  ].join('\n');

  assert.throws(
    () => assertExactContributorCheckout(hostile, 'validate'),
    /must own exactly one current-repository checkout/u,
  );
});

test('checkout source binding allows one explicit static external dependency checkout', () => {
  const valid = [
    'jobs:',
    '  scan:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    `          ${SOURCE_REF}`,
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          repository: ContextualWisdomLab/appguardrail',
    '          ref: reviewed-appguardrail-sha',
    '          persist-credentials: false',
  ].join('\n');

  assert.doesNotThrow(() => assertExactContributorCheckout(valid, 'scan'));
});

test('checkout source binding rejects ambiguous dynamic repository authority', () => {
  const hostile = [
    'jobs:',
    '  validate:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    `          ${SOURCE_REF}`,
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          repository: ${{ matrix.repository }}',
    '          ref: refs/heads/main',
  ].join('\n');

  assert.throws(
    () => assertExactContributorCheckout(hostile, 'validate'),
    /external checkout repository authority must be one static owner\/name/u,
  );
});
