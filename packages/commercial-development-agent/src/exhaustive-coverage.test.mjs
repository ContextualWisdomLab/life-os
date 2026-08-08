import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA,
  COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
  CommercialDevelopmentContractError,
  validateCommercialDevelopmentIssue,
  validateCommercialDevelopmentReceipt,
  validateCommercialDevelopmentRun,
} from './contracts.mjs';
import {
  CommercialDevelopmentCliError,
  runCommercialDevelopmentCli,
} from './cli-core.mjs';
import {
  CommercialDevelopmentDiffError,
  validateCommercialDevelopmentDiff,
} from './diff-validator.mjs';
import {
  CommercialDevelopmentSelectionError,
  selectCommercialDevelopmentIssue,
} from './issue-selector.mjs';
import {
  CommercialDevelopmentPromptError,
  buildCommercialDevelopmentPrompt,
} from './prompt-builder.mjs';
import {
  CommercialDevelopmentReceiptError,
  createCommercialDevelopmentReceipt,
  serializeCommercialDevelopmentReceipt,
} from './receipt.mjs';

const POLICY = JSON.parse(
  readFileSync(
    new URL(
      '../../../product/opencode-commercial-development-policy.json',
      import.meta.url,
    ),
    'utf8',
  ),
);
const BASE_SHA = 'a'.repeat(40);
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const INPUT_PATH = '/tmp/commercial-agent/input.json';
const OUTPUT_PATH = '/tmp/commercial-agent/output.json';

/** Returns one valid run projection. */
function run(overrides = {}) {
  return {
    schema: COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
    run_id: RUN_ID,
    repository: 'ContextualWisdomLab/life-os',
    base_sha: BASE_SHA,
    started_at: '2026-08-07T01:00:00.000Z',
    model_label: 'nvidia/default-chat-model',
    reasoning_effort: 'high',
    recursive_depth: 1,
    decomposition_steps: 8,
    roles: ['planner', 'worker', 'verifier', 'synthesizer'],
    ...overrides,
  };
}

/** Returns one valid allowlisted issue projection. */
function issue(overrides = {}) {
  return {
    number: 119,
    url: 'https://github.com/ContextualWisdomLab/life-os/issues/119',
    title:
      'Add durable Today workspace synchronization with optimistic concurrency',
    body: 'Persist one bounded Today aggregate.\nRequire explicit confirmation.',
    state: 'open',
    ...overrides,
  };
}

/** Returns one valid open pull-request projection. */
function pullRequest(overrides = {}) {
  return {
    number: 120,
    url: 'https://github.com/ContextualWisdomLab/life-os/pull/120',
    title: 'feat: unrelated bounded work',
    body: 'No linked issue.\nNo privileged authority.',
    state: 'open',
    ...overrides,
  };
}

/** Returns one accepted diff evidence projection. */
function diffEvidence(overrides = {}) {
  const content = '/** Safe. */\nexport const ready = true;\n';
  return {
    base_sha: BASE_SHA,
    current_base_sha: BASE_SHA,
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
    ...overrides,
  };
}

/** Returns one complete validated receipt. */
function receipt(overrides = {}) {
  return {
    schema: COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA,
    run_id: RUN_ID,
    repository: 'ContextualWisdomLab/life-os',
    base_sha: BASE_SHA,
    issue: {
      number: 119,
      url: 'https://github.com/ContextualWisdomLab/life-os/issues/119',
    },
    status: 'completed',
    reason_code: 'completed',
    opencode_version: '1.18.15',
    model_label: 'nvidia/default-chat-model',
    changed_files: 1,
    changed_bytes: 40,
    additions: 2,
    deletions: 0,
    branch_name: `automation/opencode-commercial-${RUN_ID}`,
    pull_request_url: 'https://github.com/ContextualWisdomLab/life-os/pull/120',
    started_at: '2026-08-07T01:00:00.000Z',
    completed_at: '2026-08-07T01:01:00.000Z',
    validations: [{ name: 'diff_policy', status: 'passed' }],
    ...overrides,
  };
}

/** Returns one receipt-composition input. */
function receiptInput(overrides = {}) {
  return {
    run: run(),
    policy: POLICY,
    issue: issue(),
    status: 'completed',
    reasonCode: 'completed',
    opencodeVersion: '1.18.15',
    diff: {
      changed_files: 1,
      changed_bytes: 40,
      additions: 2,
      deletions: 0,
    },
    branchName: `automation/opencode-commercial-${RUN_ID}`,
    pullRequestUrl: 'https://github.com/ContextualWisdomLab/life-os/pull/120',
    completedAt: '2026-08-07T01:01:00.000Z',
    validations: [{ name: 'diff_policy', status: 'passed' }],
    ...overrides,
  };
}

/** Creates a controllable in-memory asynchronous file-system seam. */
function memoryFileSystem(initialValue = receiptInput()) {
  const files = new Map([[INPUT_PATH, `${JSON.stringify(initialValue)}\n`]]);
  const controls = {
    statFile: true,
    statSize: undefined,
    statError: undefined,
    readError: undefined,
    writeError: undefined,
    renameError: undefined,
    unlinkError: undefined,
    readOverride: undefined,
  };
  const seam = {
    mkdir: vi.fn(async () => undefined),
    stat: vi.fn(async (path) => {
      if (controls.statError) throw controls.statError;
      const content = files.get(path) ?? '';
      return {
        isFile: () => controls.statFile,
        size:
          controls.statSize === undefined
            ? Buffer.byteLength(content)
            : controls.statSize,
      };
    }),
    readFile: vi.fn(async (path) => {
      if (controls.readError) throw controls.readError;
      if (controls.readOverride !== undefined) return controls.readOverride;
      return files.get(path) ?? '';
    }),
    writeFile: vi.fn(async (path, data) => {
      if (controls.writeError) throw controls.writeError;
      files.set(path, data);
    }),
    rename: vi.fn(async (oldPath, newPath) => {
      if (controls.renameError) throw controls.renameError;
      files.set(newPath, files.get(oldPath) ?? '');
      files.delete(oldPath);
    }),
    unlink: vi.fn(async (path) => {
      if (controls.unlinkError) throw controls.unlinkError;
      files.delete(path);
    }),
  };
  return { seam, controls, files };
}

/** Runs the receipt CLI through one supplied file-system seam. */
async function runReceiptCli(fileSystem, uuidFactory = () => RUN_ID) {
  return await runCommercialDevelopmentCli(
    ['receipt', '--input', INPUT_PATH, '--output', OUTPUT_PATH],
    { fileSystem, uuidFactory },
  );
}

describe('exhaustive external contract boundaries', () => {
  it.each([
    { ...run(), started_at: 'not-a-date' },
    { ...run(), roles: [] },
    { ...run(), model_label: ' model' },
  ])('rejects additional malformed run branch %#', (value) => {
    expect(() => validateCommercialDevelopmentRun(value, POLICY)).toThrow(
      CommercialDevelopmentContractError,
    );
  });

  it.each([
    { ...issue(), body: '' },
    { ...issue(), body: 'line\ttab' },
    { ...issue(), title: 'line\nbreak' },
  ])('covers issue text block boundary %#', (value) => {
    if (value.body === '') {
      expect(validateCommercialDevelopmentIssue(value, POLICY)).toEqual(value);
    } else {
      expect(() => validateCommercialDevelopmentIssue(value, POLICY)).toThrow(
        CommercialDevelopmentContractError,
      );
    }
  });

  it.each([
    { ...receipt(), issue: 42 },
    { ...receipt(), issue: { number: 0, url: 'x' } },
    {
      ...receipt(),
      issue: {
        number: 119,
        url: 'https://github.com/ContextualWisdomLab/life-os/issues/119',
        extra: true,
      },
    },
    { ...receipt(), validations: 'invalid' },
    {
      ...receipt(),
      validations: [
        { name: 'same_validation', status: 'passed' },
        { name: 'same_validation', status: 'failed' },
      ],
    },
    {
      ...receipt(),
      validations: Array.from({ length: 21 }, (_, index) => ({
        name: `validation_${index}`,
        status: 'passed',
      })),
    },
    {
      ...receipt(),
      validations: [{ name: 'Bad Validation', status: 'passed' }],
    },
    { ...receipt(), branch_name: 42 },
    { ...receipt(), pull_request_url: 42 },
    {
      ...receipt(),
      status: 'completed',
      branch_name: null,
    },
  ])('rejects additional malformed receipt branch %#', (value) => {
    expect(() => validateCommercialDevelopmentReceipt(value)).toThrow(
      CommercialDevelopmentContractError,
    );
  });

  it.each([
    'opencode_unavailable',
    'provider_unavailable',
    'no_eligible_issue',
  ])('accepts unavailable reason %s', (reasonCode) => {
    const value = receipt({
      issue: null,
      status: 'unavailable',
      reason_code: reasonCode,
      changed_files: 0,
      changed_bytes: 0,
      additions: 0,
      deletions: 0,
      branch_name: null,
      pull_request_url: null,
    });
    expect(validateCommercialDevelopmentReceipt(value)).toEqual(value);
  });
});

describe('exhaustive issue selection boundaries', () => {
  it.each([
    null,
    {},
    { ...pullRequest(), number: 0 },
    { ...pullRequest(), state: 'closed' },
    { ...pullRequest(), url: 'https://example.com/pull/120' },
    { ...pullRequest(), title: '' },
    { ...pullRequest(), title: 'x'.repeat(513) },
    { ...pullRequest(), title: 'line\nbreak' },
    { ...pullRequest(), body: 42 },
    { ...pullRequest(), body: 'line\ttab' },
    { ...pullRequest(), extra: true },
  ])('fails closed on malformed pull-request projection %#', (value) => {
    expect(() =>
      selectCommercialDevelopmentIssue({
        issues: [issue()],
        openPullRequests: [value],
        policy: POLICY,
      }),
    ).toThrow(CommercialDevelopmentSelectionError);
  });

  it('sorts eligible issues by policy title order and then number', () => {
    const policy = {
      ...POLICY,
      eligible_issue_titles: ['Second buyer outcome', issue().title],
    };
    const selected = selectCommercialDevelopmentIssue({
      issues: [
        issue({
          number: 130,
          url: 'https://github.com/ContextualWisdomLab/life-os/issues/130',
        }),
        issue({
          number: 131,
          url: 'https://github.com/ContextualWisdomLab/life-os/issues/131',
          title: 'Second buyer outcome',
        }),
      ],
      openPullRequests: [],
      policy,
    });
    expect(selected?.number).toBe(131);
  });

  it('wraps malformed policy evidence in the stable selection failure', () => {
    expect(() =>
      selectCommercialDevelopmentIssue({
        issues: [],
        openPullRequests: [],
        policy: {},
      }),
    ).toThrow(CommercialDevelopmentSelectionError);
  });

  it('sanitizes unexpected proxy failures', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private proxy detail');
        },
      },
    );
    expect(() => selectCommercialDevelopmentIssue(hostile)).toThrow(
      CommercialDevelopmentSelectionError,
    );
  });
});

describe('exhaustive prompt and receipt composition boundaries', () => {
  it('rejects an oversized prompt after valid bounded inputs', () => {
    const policy = {
      ...POLICY,
      maximum_prompt_bytes: 2_048,
      allowed_path_prefixes: Array.from(
        { length: 30 },
        (_, index) => `packages/component_${index}/`,
      ),
    };
    expect(() =>
      buildCommercialDevelopmentPrompt({ run: run(), issue: issue(), policy }),
    ).toThrow(CommercialDevelopmentPromptError);
  });

  it('wraps contract and unexpected prompt failures', () => {
    expect(() =>
      buildCommercialDevelopmentPrompt({
        run: run(),
        issue: issue(),
        policy: {},
      }),
    ).toThrow(CommercialDevelopmentPromptError);
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private prompt proxy');
        },
      },
    );
    expect(() => buildCommercialDevelopmentPrompt(hostile)).toThrow(
      CommercialDevelopmentPromptError,
    );
  });

  it.each([
    { ...receiptInput(), diff: 'invalid' },
    { ...receiptInput(), diff: { changed_files: 1 } },
    {
      ...receiptInput(),
      diff: {
        changed_files: -1,
        changed_bytes: 0,
        additions: 0,
        deletions: 0,
      },
    },
  ])('rejects malformed receipt-composition diff %#', (value) => {
    expect(() => createCommercialDevelopmentReceipt(value)).toThrow(
      CommercialDevelopmentReceiptError,
    );
  });

  it('wraps contract and unexpected receipt failures', () => {
    expect(() =>
      createCommercialDevelopmentReceipt({ ...receiptInput(), policy: {} }),
    ).toThrow(CommercialDevelopmentReceiptError);
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private receipt proxy');
        },
      },
    );
    expect(() => createCommercialDevelopmentReceipt(hostile)).toThrow(
      CommercialDevelopmentReceiptError,
    );
    expect(() => serializeCommercialDevelopmentReceipt(hostile)).toThrow(
      CommercialDevelopmentReceiptError,
    );
  });
});

describe('exhaustive diff validation boundaries', () => {
  it.each([
    { ...diffEvidence(), files: [42] },
    { ...diffEvidence(), files: [{ ...diffEvidence().files[0], status: 'C' }] },
    {
      ...diffEvidence(),
      files: [{ ...diffEvidence().files[0], binary: 'no' }],
    },
    {
      ...diffEvidence(),
      files: [{ ...diffEvidence().files[0], symlink: 'no' }],
    },
    {
      ...diffEvidence(),
      files: [{ ...diffEvidence().files[0], submodule: 'no' }],
    },
    {
      ...diffEvidence(),
      files: [{ ...diffEvidence().files[0], content: 'x\u0000' }],
    },
    { ...diffEvidence(), files: [{ ...diffEvidence().files[0], bytes: 0 }] },
    {
      ...diffEvidence(),
      files: [
        {
          ...diffEvidence().files[0],
          status: 'D',
          bytes: 0,
          additions: 1,
          deletions: 1,
          content: '',
        },
      ],
    },
  ])('fails closed on additional malformed diff branch %#', (value) => {
    expect(() => validateCommercialDevelopmentDiff(value, POLICY)).toThrow(
      CommercialDevelopmentDiffError,
    );
  });

  it('wraps malformed policy evidence in the stable diff failure', () => {
    expect(() => validateCommercialDevelopmentDiff(diffEvidence(), {})).toThrow(
      CommercialDevelopmentDiffError,
    );
  });

  it('sanitizes unexpected diff proxy failures', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('private diff proxy detail');
        },
      },
    );
    expect(() => validateCommercialDevelopmentDiff(hostile, POLICY)).toThrow(
      CommercialDevelopmentDiffError,
    );
  });
});

describe('exhaustive CLI file-system and argument boundaries', () => {
  it.each([
    null,
    [42],
    ['receipt', '--input'],
    ['receipt', 42, INPUT_PATH, '--output', OUTPUT_PATH],
    ['receipt', '--input', 42, '--output', OUTPUT_PATH],
    ['receipt', 'input', INPUT_PATH, '--output', OUTPUT_PATH],
    ['receipt', '--unknown', INPUT_PATH, '--output', OUTPUT_PATH],
    ['receipt', '--input', INPUT_PATH, '--input', INPUT_PATH],
    ['receipt', '--input', '', '--output', OUTPUT_PATH],
    ['receipt', '--input', ' /tmp/input.json', '--output', OUTPUT_PATH],
    [
      'receipt',
      '--input',
      `/tmp/${'x'.repeat(4_097)}`,
      '--output',
      OUTPUT_PATH,
    ],
  ])('rejects exhaustive malformed arguments %#', async (argv) => {
    await expect(runCommercialDevelopmentCli(argv)).rejects.toBeInstanceOf(
      CommercialDevelopmentCliError,
    );
  });

  it.each([
    ['non-file input', { statFile: false }],
    ['empty stat', { statSize: 0 }],
    ['oversized stat', { statSize: 1_048_577 }],
    ['empty read', { readOverride: '' }],
    ['oversized read', { readOverride: 'x'.repeat(1_048_577) }],
    ['NUL read', { readOverride: '{"x":"\u0000"}' }],
    ['malformed JSON', { readOverride: '{' }],
  ])('fails closed for %s', async (_label, override) => {
    const fs = memoryFileSystem();
    Object.assign(fs.controls, override);
    await expect(runReceiptCli(fs.seam)).rejects.toBeInstanceOf(
      CommercialDevelopmentCliError,
    );
  });

  it('rejects a malformed atomic-publication UUID', async () => {
    const fs = memoryFileSystem();
    await expect(
      runReceiptCli(fs.seam, () => 'not-a-uuid'),
    ).rejects.toBeInstanceOf(CommercialDevelopmentCliError);
    expect(fs.seam.writeFile).not.toHaveBeenCalled();
  });

  it('rejects read-back mismatch and removes temporary evidence', async () => {
    const fs = memoryFileSystem();
    let reads = 0;
    fs.seam.readFile.mockImplementation(async (path) => {
      reads += 1;
      if (reads === 1) return fs.files.get(path) ?? '';
      return '{}';
    });
    await expect(runReceiptCli(fs.seam)).rejects.toBeInstanceOf(
      CommercialDevelopmentCliError,
    );
    expect(fs.seam.rename).not.toHaveBeenCalled();
    expect(fs.seam.unlink).toHaveBeenCalledOnce();
  });

  it.each(['writeError', 'renameError'])('sanitizes %s', async (control) => {
    const fs = memoryFileSystem();
    fs.controls[control] = new Error('private file-system detail');
    await expect(runReceiptCli(fs.seam)).rejects.toBeInstanceOf(
      CommercialDevelopmentCliError,
    );
  });

  it('ignores absent temporary cleanup and masks other cleanup failures', async () => {
    const absent = memoryFileSystem();
    absent.controls.renameError = new Error('rename failed');
    absent.controls.unlinkError = Object.assign(new Error('absent'), {
      code: 'ENOENT',
    });
    await expect(runReceiptCli(absent.seam)).rejects.toBeInstanceOf(
      CommercialDevelopmentCliError,
    );

    const failure = memoryFileSystem();
    failure.controls.renameError = new Error('rename failed');
    failure.controls.unlinkError = new Error('private cleanup failure');
    await expect(runReceiptCli(failure.seam)).rejects.toBeInstanceOf(
      CommercialDevelopmentCliError,
    );
  });

  it('sanitizes unexpected stat and read failures', async () => {
    for (const [field, error] of [
      ['statError', new Error('private stat detail')],
      ['readError', new Error('private read detail')],
    ]) {
      const fs = memoryFileSystem();
      fs.controls[field] = error;
      await expect(runReceiptCli(fs.seam)).rejects.toBeInstanceOf(
        CommercialDevelopmentCliError,
      );
    }
  });
});
