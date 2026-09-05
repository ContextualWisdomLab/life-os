import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = process.env.LIFE_OS_REPOSITORY_ROOT
  ? resolve(process.env.LIFE_OS_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL('../../../', import.meta.url)));

async function workflowSource() {
  return await readFile(
    resolve(repositoryRoot, '.github/workflows/commercial-readiness.yml'),
    'utf8',
  );
}

function drainJobBlock(source) {
  const match = source.match(/^  drain:\n([\s\S]*?)(?=^  [A-Za-z0-9_.-]+:\n|\z)/mu);
  assert.ok(match, 'commercial readiness workflow must define the drain job');
  return match[0];
}

describe('commercial readiness merge-drain permissions', () => {
  it('grants pull-request read authority to the job that recollects PR evidence before merge', async () => {
    const drain = drainJobBlock(await workflowSource());

    assert.match(
      drain,
      /^      pull-requests:\s*read\s*$/mu,
      'drain must read pull-request reviews and metadata before any merge mutation',
    );
  });
});
