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

function mergeCompatibilityJobBlock(workflow) {
  const lines = workflow.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === '  merge_compatibility:');
  assert.notEqual(start, -1, 'missing merge_compatibility workflow job');
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_.-]+:\s*(?:#.*)?$/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('CI GitHub read retry contract', () => {
  it('bounds merge-compatibility evidence to that job before counting GitHub reads', () => {
    const hostileWorkflow = `jobs:
  merge_compatibility:
    steps:
      - run: |
          curl --fail --silent --show-error --max-time 15 \\
            --retry 2 --retry-delay 1 --retry-max-time 35 \\
            https://api.github.test/one
  later_job:
    steps:
      - run: |
          curl --fail --silent --show-error --max-time 15 \\
            --retry 2 --retry-delay 1 --retry-max-time 35 \\
            https://api.github.test/unrelated
`;

    assert.doesNotMatch(
      mergeCompatibilityJobBlock(hostileWorkflow),
      /^  later_job:/mu,
      'a later workflow job must not contribute retry evidence to merge compatibility',
    );
  });

  it('retries every merge-compatibility GitHub GET without changing mutation semantics', async () => {
    const workflow = await repositoryFile('.github/workflows/ci.yml');
    const mergeCompatibility = mergeCompatibilityJobBlock(workflow);
    const gitHubReads = [
      ...mergeCompatibility.matchAll(
        /curl --fail --silent --show-error --max-time 15 \\\n\s+--retry 2 --retry-delay 1 --retry-max-time 35 \\/gu,
      ),
    ];

    assert.equal(
      gitHubReads.length,
      4,
      'all four merge-compatibility GitHub GETs must use bounded transient retry',
    );
  });
});
