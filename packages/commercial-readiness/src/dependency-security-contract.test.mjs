import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '../../..');

describe('repository dependency security contract', () => {
  it('pins the patched Multer release throughout the frozen graph', async () => {
    const [packageJson, lockfile] = await Promise.all([
      readFile(resolve(repositoryRoot, 'package.json'), 'utf8').then(
        JSON.parse,
      ),
      readFile(resolve(repositoryRoot, 'pnpm-lock.yaml'), 'utf8'),
    ]);

    assert.equal(packageJson.pnpm?.overrides?.multer, '2.4.0');
    assert.match(lockfile, /^  multer: 2\.4\.0$/m);
    assert.match(lockfile, /^  multer@2\.4\.0:$/m);
    assert.doesNotMatch(lockfile, /^  multer@2\.[0-3]\./m);
  });
});
