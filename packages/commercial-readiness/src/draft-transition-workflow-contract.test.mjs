import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const repositoryRoot = process.env.LIFE_OS_REPOSITORY_ROOT
  ? resolve(process.env.LIFE_OS_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL('../../../', import.meta.url)));

const DRAFT_AWARE_WORKFLOWS = [
  '.github/workflows/appguardrail.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/commercial-readiness.yml',
];

async function repositoryFile(path) {
  return await readFile(resolve(repositoryRoot, path), 'utf8');
}

function yamlTopLevelBlock(source, key) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.notEqual(start, -1, `missing top-level YAML key: ${key}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_.-]+:\s*(?:#.*)?$/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function yamlChildBlock(source, key) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${key}:`);
  assert.notEqual(start, -1, `missing YAML child key: ${key}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_.-]+:\s*(?:#.*)?$/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

describe('Draft transition workflow cancellation contract', () => {
  it('creates a same-PR cancellation run when a ready pull request becomes Draft', async () => {
    for (const path of DRAFT_AWARE_WORKFLOWS) {
      const workflow = await repositoryFile(path);
      const triggerBlock = yamlTopLevelBlock(workflow, 'on');
      const pullRequestBlock = yamlChildBlock(triggerBlock, 'pull_request');

      assert.match(
        pullRequestBlock,
        /^\s+types:\s*\[opened, synchronize, reopened, ready_for_review, converted_to_draft\]\s*$/mu,
        `${path} must trigger converted_to_draft so workflow concurrency can cancel superseded ready-PR work`,
      );
      assert.match(
        workflow,
        /group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.repository \}\}-\$\{\{ github\.event_name == 'pull_request' && github\.event\.pull_request\.number \|\| github\.run_id \}\}/u,
        `${path} must keep cancellation scoped to the same pull request`,
      );
      assert.match(
        workflow,
        /cancel-in-progress:\s*\$\{\{ github\.event_name == 'pull_request' \}\}/u,
        `${path} must cancel superseded pull-request work`,
      );
    }
  });
});
