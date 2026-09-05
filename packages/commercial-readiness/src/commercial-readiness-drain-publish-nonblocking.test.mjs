import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

const repositoryRoot = process.env.LIFE_OS_REPOSITORY_ROOT
  ? resolve(process.env.LIFE_OS_REPOSITORY_ROOT)
  : resolve(fileURLToPath(new URL('../../../', import.meta.url)));

function yamlJobBlock(source, jobName) {
  const lines = source.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing workflow job: ${jobName}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_.-]+:\s*(?:#.*)?$/u.test(lines[index] ?? '')) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

it('keeps readiness publishing ordered but non-authoritative for merge drain execution', async () => {
  const workflow = await readFile(
    resolve(repositoryRoot, '.github/workflows/commercial-readiness.yml'),
    'utf8',
  );
  const drain = yamlJobBlock(workflow, 'drain');

  assert.match(
    drain,
    /^\s+needs:\s*\[audit, publish\]\s*$/mu,
    'drain must wait for both audit evidence and readiness publication to settle',
  );
  assert.match(
    drain,
    /^\s+always\(\)\s*$/mu,
    'drain must evaluate its own gate after readiness publication fails or is skipped',
  );
  assert.match(
    drain,
    /^\s+&& needs\.audit\.result == 'success'\s*$/mu,
    'merge mutation must still require the authoritative audit job to succeed',
  );
  assert.doesNotMatch(
    drain,
    /needs\.publish\.result\s*==\s*'success'/u,
    'living-issue publication is reporting evidence and must not become merge authority',
  );
});
