import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SELF_REPOSITORY = 'contextualwisdomlab/life-os';

/** Reads one static YAML scalar without evaluating expressions. */
function staticScalarValue(value) {
  if (value === undefined) {
    return undefined;
  }

  const doubleQuoted = /^("(?:[^"\\]|\\.)*")(?:\s+#.*)?$/u.exec(value);
  if (doubleQuoted) {
    return JSON.parse(doubleQuoted[1]);
  }

  const singleQuoted = /^'((?:[^']|'')*)'(?:\s+#.*)?$/u.exec(value);
  if (singleQuoted) {
    return singleQuoted[1].replaceAll("''", "'");
  }

  const comment = /\s+#/u.exec(value);
  return (comment ? value.slice(0, comment.index) : value).trim();
}

/** Extracts exactly one direct job from the top-level jobs mapping. */
function namedJob(workflow, jobName) {
  const lines = workflow.split('\n');
  const jobs = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line === 'jobs:');
  assert.equal(jobs.length, 1, 'workflow must contain exactly one jobs mapping');

  const jobsStart = jobs[0].index;
  let jobsEnd = lines.length;
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    if (/^[^\s#]/u.test(lines[index])) {
      jobsEnd = index;
      break;
    }
  }

  const jobPattern = /^  ([A-Za-z_][A-Za-z0-9_-]*):\s*(?:#.*)?$/u;
  const starts = [];
  for (let index = jobsStart + 1; index < jobsEnd; index += 1) {
    const match = jobPattern.exec(lines[index]);
    if (match) {
      starts.push({ index, name: match[1] });
    }
  }
  const matches = starts.filter(({ name }) => name === jobName);
  assert.equal(matches.length, 1, `expected exactly one workflow job ${jobName}`);
  const start = matches[0].index;
  const position = starts.findIndex(({ index }) => index === start);
  const end = position + 1 < starts.length ? starts[position + 1].index : jobsEnd;
  return lines.slice(start, end);
}

/** Returns direct step blocks from one bounded job. */
function stepBlocks(jobLines) {
  const jobIndent = /^\s*/u.exec(jobLines[0])?.[0].length ?? 0;
  const keyIndent = jobIndent + 2;
  const stepIndent = keyIndent + 2;
  const stepsIndexes = [];
  for (let index = 1; index < jobLines.length; index += 1) {
    if (jobLines[index] === `${' '.repeat(keyIndent)}steps:`) {
      stepsIndexes.push(index);
    }
  }
  assert.equal(stepsIndexes.length, 1, 'job must contain exactly one direct steps mapping');

  const starts = [];
  for (let index = stepsIndexes[0] + 1; index < jobLines.length; index += 1) {
    const line = jobLines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    const indent = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (indent <= keyIndent) {
      break;
    }
    if (indent === stepIndent && line.startsWith(`${' '.repeat(stepIndent)}- `)) {
      starts.push(index);
    }
  }

  return starts.map((start, position) => {
    const end = position + 1 < starts.length ? starts[position + 1] : jobLines.length;
    return { lines: jobLines.slice(start, end), stepIndent };
  });
}

/** Reads one direct scalar from a step, including an inline sequence key. */
function directStepScalar(step, key) {
  const directIndent = ' '.repeat(step.stepIndent + 2);
  const inlinePrefix = `${' '.repeat(step.stepIndent)}- ${key}:`;
  const directPrefix = `${directIndent}${key}:`;
  const values = [];
  if (step.lines[0]?.startsWith(inlinePrefix)) {
    values.push(step.lines[0].slice(inlinePrefix.length).trim());
  }
  for (const line of step.lines.slice(1)) {
    if (line.startsWith(directPrefix)) {
      values.push(line.slice(directPrefix.length).trim());
    }
  }
  assert.ok(values.length <= 1, `step must not duplicate direct ${key}`);
  return values[0];
}

/** Reads direct with entries and rejects duplicate mapping authority. */
function directWithMap(step) {
  const directIndent = ' '.repeat(step.stepIndent + 2);
  const entryIndent = ' '.repeat(step.stepIndent + 4);
  const withLine = `${directIndent}with:`;
  const indexes = [];
  for (let index = 1; index < step.lines.length; index += 1) {
    if (step.lines[index] === withLine) {
      indexes.push(index);
    }
  }
  assert.ok(indexes.length <= 1, 'checkout step must not duplicate direct with mapping');
  if (indexes.length === 0) {
    return new Map();
  }

  const entries = new Map();
  for (let index = indexes[0] + 1; index < step.lines.length; index += 1) {
    const line = step.lines[index];
    if (!line.startsWith(entryIndent)) {
      break;
    }
    const relative = line.slice(entryIndent.length);
    if (relative.startsWith(' ') || relative.trim().length === 0 || relative.trimStart().startsWith('#')) {
      continue;
    }
    const separator = relative.indexOf(':');
    assert.ok(separator > 0, 'checkout with entry must be one direct key/value scalar');
    const key = relative.slice(0, separator).trim();
    const value = relative.slice(separator + 1).trim();
    assert.ok(!entries.has(key), `checkout step must not duplicate direct ${key} authority`);
    entries.set(key, value);
  }
  return entries;
}

/** Requires external dependency checkouts to stay below the current workspace root. */
function assertExternalCheckoutIsolation(workflow, jobName) {
  const job = namedJob(workflow, jobName);
  for (const step of stepBlocks(job)) {
    const uses = staticScalarValue(directStepScalar(step, 'uses'));
    if (!uses?.startsWith('actions/checkout@')) {
      continue;
    }

    const withEntries = directWithMap(step);
    const repositoryValue = withEntries.get('repository');
    if (repositoryValue === undefined) {
      continue;
    }
    const repository = staticScalarValue(repositoryValue);
    assert.ok(repository, 'checkout repository authority must be a non-empty static scalar');
    if (repository.toLowerCase() === SELF_REPOSITORY || repository === '${{ github.repository }}') {
      continue;
    }
    assert.match(
      repository,
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
      'external checkout repository authority must be one static owner/name',
    );

    const pathValue = withEntries.get('path');
    assert.notEqual(pathValue, undefined, 'external checkout must use one direct isolated path');
    const path = staticScalarValue(pathValue);
    assert.ok(path, 'external checkout path must be a non-empty static scalar');
    assert.doesNotMatch(path, /\$\{\{/u, 'external checkout path must not be dynamic');
    assert.doesNotMatch(path, /^[\\/]/u, 'external checkout path must be workspace-relative');
    assert.doesNotMatch(path, /\\/u, 'external checkout path must use portable forward slashes');
    const segments = path.split('/');
    assert.ok(
      segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..'),
      'external checkout path must remain in a non-root workspace subdirectory',
    );
  }
}

const actualWorkflow = readFileSync(
  join(REPOSITORY_ROOT, '.github/workflows/appguardrail.yml'),
  'utf8',
);

test('AppGuardrail external dependency checkout cannot replace the LifeOS workspace root', () => {
  assert.doesNotThrow(() => assertExternalCheckoutIsolation(actualWorkflow, 'scan'));
});

test('external checkout without a path is rejected', () => {
  const hostile = [
    'jobs:',
    '  scan:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          repository: ContextualWisdomLab/appguardrail',
    '          ref: reviewed-appguardrail-sha',
    '          persist-credentials: false',
  ].join('\n');
  assert.throws(() => assertExternalCheckoutIsolation(hostile, 'scan'), /must use one direct isolated path/u);
});

test('external checkout cannot target the workspace root or escape it', () => {
  for (const unsafePath of ['.', '..', '../appguardrail', 'nested/../appguardrail', '/tmp/appguardrail']) {
    const hostile = [
      'jobs:',
      '  scan:',
      '    steps:',
      '      - uses: actions/checkout@reviewed-sha',
      '        with:',
      '          repository: ContextualWisdomLab/appguardrail',
      `          path: ${unsafePath}`,
      '          ref: reviewed-appguardrail-sha',
    ].join('\n');
    assert.throws(() => assertExternalCheckoutIsolation(hostile, 'scan'));
  }
});

test('external checkout path cannot be runtime-dynamic', () => {
  const hostile = [
    'jobs:',
    '  scan:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          repository: ContextualWisdomLab/appguardrail',
    '          path: ${{ github.workspace }}',
    '          ref: reviewed-appguardrail-sha',
  ].join('\n');
  assert.throws(() => assertExternalCheckoutIsolation(hostile, 'scan'), /must not be dynamic/u);
});

test('external checkout cannot overwrite a LifeOS source subtree', () => {
  const hostile = [
    'jobs:',
    '  scan:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          repository: ContextualWisdomLab/appguardrail',
    '          path: packages/commercial-readiness',
    '          ref: reviewed-appguardrail-sha',
  ].join('\n');
  assert.throws(
    () => assertExternalCheckoutIsolation(hostile, 'scan'),
    /reviewed external checkout path/u,
  );
});

test('external checkout may use one explicit isolated subdirectory', () => {
  const valid = [
    'jobs:',
    '  scan:',
    '    steps:',
    '      - uses: actions/checkout@reviewed-sha',
    '        with:',
    '          repository: ContextualWisdomLab/appguardrail',
    '          path: _appguardrail',
    '          ref: reviewed-appguardrail-sha',
    '          persist-credentials: false',
  ].join('\n');
  assert.doesNotThrow(() => assertExternalCheckoutIsolation(valid, 'scan'));
});
