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

    const snapshotStart = workflow.indexOf(
      'node packages/commercial-readiness/src/cli.mjs snapshot',
    );
    assert.notEqual(snapshotStart, -1);
    const snapshotEnd = workflow.indexOf('\n\n', snapshotStart);
    assert.notEqual(snapshotEnd, -1);
    const snapshotCommand = workflow.slice(snapshotStart, snapshotEnd);

    assert.match(
      snapshotCommand,
      new RegExp(`--commit "${sourceExpression}"`),
    );
    assert.doesNotMatch(snapshotCommand, /--commit "\$GITHUB_SHA"/);
  });
});
