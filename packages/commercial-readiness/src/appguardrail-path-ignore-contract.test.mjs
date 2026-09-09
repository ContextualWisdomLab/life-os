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

function assertAppGuardrailPathIgnoreContract(workflow) {
  assert.match(workflow, /^\s+- docs\/\*\*\s*$/mu);
  assert.match(workflow, /^\s+- ['"]\*\.md['"]\s*$/mu);
  assert.doesNotMatch(workflow, /^\s+- ['"]\*\*\.md['"]\s*$/mu);
}

describe('AppGuardrail path-ignore contract', () => {
  it('keeps markdown exclusion limited to repository-root Markdown files', async () => {
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
});
