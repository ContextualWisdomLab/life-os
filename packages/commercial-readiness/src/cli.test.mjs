import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { parseArguments, readJsonFile } from './cli.mjs';

describe('parseArguments', () => {
  it('parses bounded command options without interpreting values as shell syntax', () => {
    assert.deepEqual(
      parseArguments([
        'snapshot',
        '--repository',
        'ContextualWisdomLab/life-os',
        '--policy',
        'product/commercial-readiness-policy.json',
        '--output',
        'out/snapshot.json',
        '--commit',
        'a'.repeat(40),
      ]),
      {
        command: 'snapshot',
        options: {
          repository: 'ContextualWisdomLab/life-os',
          policy: 'product/commercial-readiness-policy.json',
          output: 'out/snapshot.json',
          commit: 'a'.repeat(40),
        },
      },
    );
  });

  it('parses the read-only workflow registry evidence command', () => {
    assert.deepEqual(
      parseArguments([
        'workflow-registry',
        '--repository',
        'ContextualWisdomLab/life-os',
        '--commit',
        'b'.repeat(40),
        '--generated-at',
        '2026-08-13T11:30:00.000Z',
        '--output',
        'out/workflow-registry.json',
      ]),
      {
        command: 'workflow-registry',
        options: {
          repository: 'ContextualWisdomLab/life-os',
          commit: 'b'.repeat(40),
          generatedAt: '2026-08-13T11:30:00.000Z',
          output: 'out/workflow-registry.json',
        },
      },
    );
  });

  it('rejects unknown commands, duplicate options, missing values, and positional arguments', () => {
    for (const argv of [
      ['unknown'],
      ['snapshot', '--repository', 'o/r', '--repository', 'o/r'],
      ['snapshot', '--repository'],
      ['snapshot', 'unexpected'],
      ['drain', '--execute'],
    ]) {
      assert.throws(
        () => parseArguments(argv),
        /Invalid commercial readiness command/,
      );
    }
  });
});

describe('readJsonFile', () => {
  it('reads bounded regular JSON files and rejects symlinks or oversized input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'life-os-cli-'));
    const valid = join(root, 'valid.json');
    const target = join(root, 'target.json');
    const link = join(root, 'link.json');
    const large = join(root, 'large.json');
    await writeFile(valid, '{"ok":true}', 'utf8');
    await writeFile(target, '{"secret":true}', 'utf8');
    await symlink(target, link);
    await writeFile(large, JSON.stringify({ value: 'x'.repeat(2048) }), 'utf8');

    assert.deepEqual(await readJsonFile(valid, 1024), { ok: true });
    await assert.rejects(
      () => readJsonFile(link, 1024),
      /JSON input must be a regular file/,
    );
    await assert.rejects(
      () => readJsonFile(large, 1024),
      /JSON input exceeded the size limit/,
    );
  });
});
