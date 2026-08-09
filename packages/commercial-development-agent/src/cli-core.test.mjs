import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CommercialDevelopmentCliError,
  runCommercialDevelopmentCli,
} from './cli-core.mjs';
import { COMMERCIAL_DEVELOPMENT_RUN_SCHEMA } from './contracts.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_PATH = resolve(
  PACKAGE_ROOT,
  '../../product/opencode-commercial-development-policy.json',
);
const RUN_ID = '11111111-1111-4111-8111-111111111111';
let directory;

/** Writes one JSON fixture and returns its absolute path. */
async function fixture(name, value) {
  const path = join(directory, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path;
}

/** Reads one JSON output fixture. */
async function output(name) {
  return JSON.parse(await readFile(join(directory, name), 'utf8'));
}

/** Returns one eligible issue projection. */
function issue() {
  return {
    number: 119,
    url: 'https://github.com/ContextualWisdomLab/life-os/issues/119',
    title:
      'Add durable Today workspace synchronization with optimistic concurrency',
    body: 'Implement one bounded durable Today synchronization slice.',
    state: 'open',
  };
}

/** Returns one complete run projection. */
function run() {
  return {
    schema: COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
    run_id: RUN_ID,
    repository: 'ContextualWisdomLab/life-os',
    base_sha: 'a'.repeat(40),
    started_at: '2026-08-07T01:00:00.000Z',
    model_label: 'nvidia/default-chat-model',
    reasoning_effort: 'high',
    recursive_depth: 1,
    decomposition_steps: 8,
    roles: ['planner', 'worker', 'verifier', 'synthesizer'],
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'life-os-commercial-agent-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('commercial development CLI core', () => {
  it('selects one bounded issue and writes a private atomic JSON file', async () => {
    const issuesPath = await fixture('issues.json', [issue()]);
    const pullsPath = await fixture('pulls.json', []);
    const outputPath = join(directory, 'selected.json');

    await expect(
      runCommercialDevelopmentCli(
        [
          'select',
          '--policy',
          POLICY_PATH,
          '--issues',
          issuesPath,
          '--pulls',
          pullsPath,
          '--output',
          outputPath,
        ],
        { uuidFactory: () => '22222222-2222-4222-8222-222222222222' },
      ),
    ).resolves.toEqual(issue());
    expect(await output('selected.json')).toEqual(issue());
    expect((await stat(outputPath)).mode & 0o777).toBe(0o600);
  });

  it('writes null when no eligible issue exists', async () => {
    const issuesPath = await fixture('issues.json', [
      { ...issue(), title: 'Unallowlisted work' },
    ]);
    const pullsPath = await fixture('pulls.json', []);
    const outputPath = join(directory, 'selected.json');
    await expect(
      runCommercialDevelopmentCli([
        'select',
        '--policy',
        POLICY_PATH,
        '--issues',
        issuesPath,
        '--pulls',
        pullsPath,
        '--output',
        outputPath,
      ]),
    ).resolves.toBeUndefined();
    expect(await output('selected.json')).toBeNull();
  });

  it('builds and writes one bounded prompt document', async () => {
    const runPath = await fixture('run.json', run());
    const issuePath = await fixture('issue.json', issue());
    const outputPath = join(directory, 'prompt.json');
    const result = await runCommercialDevelopmentCli([
      'prompt',
      '--policy',
      POLICY_PATH,
      '--run',
      runPath,
      '--issue',
      issuePath,
      '--output',
      outputPath,
    ]);
    expect(result.text).toContain('UNTRUSTED_ISSUE_DATA_BEGIN');
    expect(await output('prompt.json')).toEqual(result);
  });

  it('validates and writes one diff decision', async () => {
    const content = '/** Safe change. */\nexport const durableToday = true;\n';
    const evidencePath = await fixture('diff.json', {
      base_sha: 'a'.repeat(40),
      current_base_sha: 'a'.repeat(40),
      files: [
        {
          path: 'apps/planning-service/src/durable-today.ts',
          status: 'A',
          bytes: Buffer.byteLength(content),
          additions: 2,
          deletions: 0,
          binary: false,
          symlink: false,
          submodule: false,
          content,
        },
      ],
    });
    const outputPath = join(directory, 'decision.json');
    const result = await runCommercialDevelopmentCli([
      'validate-diff',
      '--policy',
      POLICY_PATH,
      '--evidence',
      evidencePath,
      '--output',
      outputPath,
    ]);
    expect(result).toMatchObject({ accepted: true, reason_code: 'accepted' });
    expect(await output('decision.json')).toEqual(result);
  });

  it('composes and writes a credential-free receipt', async () => {
    const inputPath = await fixture('receipt-input.json', {
      run: run(),
      policy: JSON.parse(await readFile(POLICY_PATH, 'utf8')),
      issue: null,
      status: 'unavailable',
      reasonCode: 'provider_credential_missing',
      opencodeVersion: '1.2.3',
      diff: null,
      branchName: null,
      pullRequestUrl: null,
      completedAt: '2026-08-07T01:00:01.000Z',
      validations: [
        { name: 'provider_credential', status: 'failed' },
        { name: 'diff_policy', status: 'skipped' },
      ],
    });
    const outputPath = join(directory, 'receipt.json');
    const result = await runCommercialDevelopmentCli([
      'receipt',
      '--input',
      inputPath,
      '--output',
      outputPath,
    ]);
    expect(result).toMatchObject({
      status: 'unavailable',
      reason_code: 'provider_credential_missing',
    });
    expect(await output('receipt.json')).toEqual(result);
  });

  it.each([
    [],
    ['unknown'],
    ['select', '--policy', POLICY_PATH],
    ['select', '--policy', POLICY_PATH, '--policy', POLICY_PATH],
    ['select', '--unknown', POLICY_PATH],
    ['select', '--policy', 'relative.json'],
    ['select', '--policy', `${POLICY_PATH}\n`],
    [
      'select',
      '--policy',
      `${POLICY_PATH}\u0001`,
      '--issues',
      POLICY_PATH,
      '--pulls',
      POLICY_PATH,
      '--output',
      POLICY_PATH,
    ],
  ])('rejects invalid CLI arguments %#', async (...argv) => {
    await expect(runCommercialDevelopmentCli(argv)).rejects.toBeInstanceOf(
      CommercialDevelopmentCliError,
    );
  });

  it('rejects malformed and non-string atomic publication identifiers', async () => {
    const inputPath = await fixture('receipt-input.json', {
      run: run(),
      policy: JSON.parse(await readFile(POLICY_PATH, 'utf8')),
      issue: null,
      status: 'unavailable',
      reasonCode: 'provider_credential_missing',
      opencodeVersion: '1.2.3',
      diff: null,
      branchName: null,
      pullRequestUrl: null,
      completedAt: '2026-08-07T01:00:01.000Z',
      validations: [{ name: 'provider_credential', status: 'failed' }],
    });
    const argv = [
      'receipt',
      '--input',
      inputPath,
      '--output',
      join(directory, 'receipt.json'),
    ];
    for (const uuidFactory of [() => 'not-a-uuid', () => 42]) {
      await expect(
        runCommercialDevelopmentCli(argv, { uuidFactory }),
      ).rejects.toBeInstanceOf(CommercialDevelopmentCliError);
    }
  });

  it('rejects malformed and oversized JSON without retaining its content', async () => {
    const malformed = join(directory, 'malformed.json');
    await writeFile(malformed, '{private', 'utf8');
    await expect(
      runCommercialDevelopmentCli([
        'receipt',
        '--input',
        malformed,
        '--output',
        join(directory, 'receipt.json'),
      ]),
    ).rejects.toEqual(new CommercialDevelopmentCliError());

    const oversized = join(directory, 'oversized.json');
    await writeFile(oversized, 'x'.repeat(1_048_577), 'utf8');
    await expect(
      runCommercialDevelopmentCli([
        'receipt',
        '--input',
        oversized,
        '--output',
        join(directory, 'receipt.json'),
      ]),
    ).rejects.toEqual(new CommercialDevelopmentCliError());
  });
});
