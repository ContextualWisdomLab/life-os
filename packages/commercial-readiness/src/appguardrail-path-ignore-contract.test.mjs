import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = process.env.LIFE_OS_REPOSITORY_ROOT
  ? resolve(process.env.LIFE_OS_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL('../../../', import.meta.url)));

async function repositoryFile(path) {
  return await readFile(resolve(repositoryRoot, path), 'utf8');
}

function triggerBlock(workflow, trigger) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${trigger}:`);
  assert.notEqual(start, -1, `missing ${trigger} trigger`);

  const nextTrigger = lines.findIndex(
    (line, index) =>
      index > start && /^  [A-Za-z_][A-Za-z0-9_-]*:\s*$/.test(line),
  );

  return lines
    .slice(start + 1, nextTrigger === -1 ? undefined : nextTrigger)
    .join('\n');
}

function pathsIgnoreBlock(workflow, trigger) {
  const lines = triggerBlock(workflow, trigger).split('\n');
  const start = lines.findIndex((line) => /^    paths-ignore:\s*$/.test(line));
  assert.notEqual(start, -1, `missing ${trigger}.paths-ignore`);

  const nextKey = lines.findIndex(
    (line, index) =>
      index > start && /^    [A-Za-z_][A-Za-z0-9_-]*:\s*(?:#.*)?$/.test(line),
  );

  return lines
    .slice(start + 1, nextKey === -1 ? undefined : nextKey)
    .join('\n');
}

function assertTriggerPathIgnoreContract(workflow, trigger) {
  const block = pathsIgnoreBlock(workflow, trigger);

  assert.match(block, /^      - docs\/\*\*\s*$/mu);
  assert.match(block, /^      - ['"]\*\.md['"]\s*$/mu);
  assert.doesNotMatch(block, /^      - ['"]\*\*\.md['"]\s*$/mu);
}

function assertAppGuardrailPathIgnoreContract(workflow) {
  for (const trigger of ['pull_request', 'push']) {
    assertTriggerPathIgnoreContract(workflow, trigger);
  }
}

describe('AppGuardrail path-ignore contract', () => {
  it('keeps markdown exclusion limited to repository-root Markdown files for every code trigger', async () => {
    const workflow = await repositoryFile('.github/workflows/appguardrail.yml');

    assertAppGuardrailPathIgnoreContract(workflow);
  });

  it('rejects a trigger that drops the root Markdown exclusion', async () => {
    const workflow = await repositoryFile('.github/workflows/appguardrail.yml');
    const malformed = workflow.replace(
      "  push:\n    branches: [main]\n    paths-ignore:\n      - docs/**\n      - '*.md'",
      '  push:\n    branches: [main]\n    paths-ignore:\n      - docs/**',
    );

    assert.notEqual(malformed, workflow);
    assert.throws(() => assertAppGuardrailPathIgnoreContract(malformed));
  });

  it('rejects path-ignore entries borrowed from another trigger-level list', async () => {
    const workflow = await repositoryFile('.github/workflows/appguardrail.yml');
    const malformed = workflow.replace(
      "  push:\n    branches: [main]\n    paths-ignore:\n      - docs/**\n      - '*.md'",
      "  push:\n    branches: [main]\n    paths-ignore:\n    paths:\n      - docs/**\n      - '*.md'",
    );

    assert.notEqual(malformed, workflow);
    assert.throws(() => assertAppGuardrailPathIgnoreContract(malformed));
  });
});
