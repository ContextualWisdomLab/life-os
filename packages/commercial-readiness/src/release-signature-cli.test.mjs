import assert from 'node:assert/strict';
import test from 'node:test';

import { commandVerifyRelease, parseArguments } from './cli.mjs';

test('parseArguments exposes only the bounded release-verification surface', () => {
  assert.deepEqual(
    parseArguments([
      'verify-release',
      '--index',
      'release-evidence.json',
      '--artifacts',
      'dist/release',
      '--trusted-keys',
      'release-trusted-keys.json',
    ]),
    {
      command: 'verify-release',
      options: {
        index: 'release-evidence.json',
        artifacts: 'dist/release',
        trustedKeys: 'release-trusted-keys.json',
      },
    },
  );

  assert.throws(
    () =>
      parseArguments([
        'verify-release',
        '--index',
        'release-evidence.json',
        '--artifacts',
        'dist/release',
        '--trusted-keys',
        'release-trusted-keys.json',
        '--repository',
        'ContextualWisdomLab/life-os',
      ]),
    /Invalid commercial readiness command/,
  );
});

test('commandVerifyRelease reads bounded inputs and delegates exact verification identities', async () => {
  const index = Object.freeze({ schema_version: 'life-os.release-evidence.v1' });
  const trustedKeys = Object.freeze({ 'release-operator-1': 'public-key' });
  const reads = [];
  let verificationArguments;
  let output;

  const result = await commandVerifyRelease(
    {
      index: 'release-evidence.json',
      artifacts: 'dist/release',
      trustedKeys: 'release-trusted-keys.json',
    },
    {
      readJsonFile: async (path, maxBytes) => {
        reads.push([path, maxBytes]);
        return path === 'release-evidence.json' ? index : trustedKeys;
      },
      verifyReleaseEvidenceSignatures: async (...args) => {
        verificationArguments = args;
        return Object.freeze({
          version: '0.1.0-rc.1',
          source_commit: 'a'.repeat(40),
        });
      },
      log: (message) => {
        output = message;
      },
    },
  );

  assert.deepEqual(reads, [
    ['release-evidence.json', 1024 * 1024],
    ['release-trusted-keys.json', 256 * 1024],
  ]);
  assert.deepEqual(verificationArguments, [index, 'dist/release', trustedKeys]);
  assert.equal(result.version, '0.1.0-rc.1');
  assert.equal(
    output,
    `release verified: 0.1.0-rc.1 @ ${'a'.repeat(40)}`,
  );
});
