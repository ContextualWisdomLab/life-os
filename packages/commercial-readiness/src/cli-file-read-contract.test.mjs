import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const cliUrl = new URL('./cli.mjs', import.meta.url);

test('bounded JSON inputs are opened without following a final symlink', async () => {
  const source = await readFile(cliUrl, 'utf8');
  const start = source.indexOf('export async function readJsonFile');
  const end = source.indexOf('\nasync function readTextFile', start);
  assert.ok(start >= 0 && end > start, 'readJsonFile implementation must remain discoverable');
  const implementation = source.slice(start, end);

  assert.match(implementation, /open\(/u);
  assert.match(implementation, /O_NOFOLLOW/u);
  assert.match(implementation, /handle\.stat\(\)/u);
  assert.doesNotMatch(implementation, /lstat\(/u);
  assert.doesNotMatch(implementation, /readFile\(/u);
});
