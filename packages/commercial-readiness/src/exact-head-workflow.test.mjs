import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = process.env.LIFE_OS_REPOSITORY_ROOT
  ? resolve(process.env.LIFE_OS_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL('../../../', import.meta.url)));

describe('commercial readiness exact-head contract', () => {
  it('binds PR checkout and evidence commit to the contributor head rather than the synthetic merge SHA', async () => {
    const workflow = await readFile(
      resolve(repositoryRoot, '.github/workflows/commercial-readiness.yml'),
      'utf8',
    );
    const sourceExpression =
      '\\$\\{\\{ github\\.event\\.pull_request\\.head\\.sha \\|\\| github\\.sha \\}\\}';
    assert.match(workflow, new RegExp(`ref: ${sourceExpression}`));
    assert.match(
      workflow,
      new RegExp(`--commit "${sourceExpression}"`),
    );
    assert.doesNotMatch(workflow, /--commit "\$GITHUB_SHA"/);
  });
});
