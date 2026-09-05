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

describe('AppGuardrail workflow path admission', () => {
  it('ignores Markdown-only changes at any repository depth', async () => {
    const workflow = await repositoryFile('.github/workflows/appguardrail.yml');
    const triggerBlock = yamlTopLevelBlock(workflow, 'on');

    for (const eventName of ['pull_request', 'push']) {
      const eventBlock = yamlChildBlock(triggerBlock, eventName);
      assert.match(
        eventBlock,
        /^\s+- '\*\*\.md'\s*$/mu,
        `${eventName} must ignore Markdown files below the repository root as well as root Markdown`,
      );
      assert.doesNotMatch(
        eventBlock,
        /^\s+- '\*\.md'\s*$/mu,
        `${eventName} must not retain the root-only Markdown glob`,
      );
    }
  });
});
