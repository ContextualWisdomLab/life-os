import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  parseProposalLiveModelInventory,
  ProposalLiveCommandError,
  publishProposalLiveConformanceReport,
  runProposalQualityLiveCommand,
  type ProposalLiveCommandFileSystem,
} from './proposal-quality-live-command';
import {
  runProposalLiveConformance,
  type ProposalLiveConformanceOptions,
  type ProposalLiveConformanceReport,
} from './proposal-quality-live-conformance';

const LIFE_OS_SHA = 'a'.repeat(40);
const ORCHESTRATOR_SHA = 'b'.repeat(40);
const EVALUATED_AT = new Date('2026-08-06T07:00:00.000Z');
const TOKEN = Buffer.alloc(32, 0x43).toString('base64url');
const REPORT_PATH = '/tmp/life-os-live-conformance/report.json';

/** Builds one complete command environment with optional overrides. */
function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    AI_NIM_LIVE_CONFORMANCE_ENABLED: 'true',
    NVIDIA_NIM_API_KEY_AVAILABLE: 'false',
    NVIDIA_NIM_CHAT_MODELS: 'model-a, model-b',
    LIFE_OS_COMMIT_SHA: LIFE_OS_SHA,
    CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA: ORCHESTRATOR_SHA,
    CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
    CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
    PROPOSAL_LIVE_EVALUATED_AT: EVALUATED_AT.toISOString(),
    PROPOSAL_LIVE_REPORT_PATH: REPORT_PATH,
    ...overrides,
  };
}

/** Creates one valid no-provider report without external I/O. */
async function validReport(): Promise<ProposalLiveConformanceReport> {
  return await runProposalLiveConformance({
    lifeOsCommitSha: LIFE_OS_SHA,
    contextualOrchestratorCommitSha: ORCHESTRATOR_SHA,
    modelInventory: ['model-a'],
    evaluatedAt: EVALUATED_AT,
    providerCredentialAvailable: false,
    environment: {},
  });
}

/** Creates a fully observable mocked publication file system. */
function fileSystem(): {
  seam: ProposalLiveCommandFileSystem;
  mkdir: ReturnType<typeof vi.fn<ProposalLiveCommandFileSystem['mkdir']>>;
  writeFile: ReturnType<
    typeof vi.fn<ProposalLiveCommandFileSystem['writeFile']>
  >;
  rename: ReturnType<typeof vi.fn<ProposalLiveCommandFileSystem['rename']>>;
  unlink: ReturnType<typeof vi.fn<ProposalLiveCommandFileSystem['unlink']>>;
} {
  const mkdir = vi.fn<ProposalLiveCommandFileSystem['mkdir']>(
    async () => undefined,
  );
  const writeFile = vi.fn<ProposalLiveCommandFileSystem['writeFile']>(
    async () => undefined,
  );
  const rename = vi.fn<ProposalLiveCommandFileSystem['rename']>(
    async () => undefined,
  );
  const unlink = vi.fn<ProposalLiveCommandFileSystem['unlink']>(
    async () => undefined,
  );
  return {
    seam: { mkdir, writeFile, rename, unlink },
    mkdir,
    writeFile,
    rename,
    unlink,
  };
}

describe('live conformance model inventory parser', () => {
  it('returns immutable normalized explicit model identifiers', () => {
    expect(parseProposalLiveModelInventory(undefined)).toEqual([]);
    expect(parseProposalLiveModelInventory('   ')).toEqual([]);
    const models = parseProposalLiveModelInventory(
      'meta/model-a, nvidia/model_b:latest',
    );
    expect(models).toEqual(['meta/model-a', 'nvidia/model_b:latest']);
    expect(Object.isFrozen(models)).toBe(true);
  });

  it.each([
    ',model-a',
    'model a',
    'model-a,model-a',
    'x'.repeat(4_097),
    'model-a\nmodel-b',
    Array.from({ length: 5 }, (_, index) => `model-${index}`).join(','),
  ])('rejects unsafe model inventory %#', (value) => {
    expect(() => parseProposalLiveModelInventory(value)).toThrow(
      ProposalLiveCommandError,
    );
  });
});

describe('atomic live report publication', () => {
  it('writes restrictive validated JSON before atomic rename', async () => {
    const report = await validReport();
    const fs = fileSystem();

    await publishProposalLiveConformanceReport(
      report,
      REPORT_PATH,
      fs.seam,
      () => 'temporary-report-token',
    );

    expect(fs.mkdir).toHaveBeenCalledWith('/tmp/life-os-live-conformance', {
      recursive: true,
    });
    const temporaryPath = `${REPORT_PATH}.temporary-temporary-report-token`;
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
    const [path, payload, options] = fs.writeFile.mock.calls[0] ?? [];
    expect(path).toBe(temporaryPath);
    expect(options).toEqual({ encoding: 'utf8', mode: 0o600, flag: 'wx' });
    expect(JSON.parse(String(payload))).toEqual(report);
    expect(fs.rename).toHaveBeenCalledWith(temporaryPath, REPORT_PATH);
    expect(fs.unlink).not.toHaveBeenCalled();
  });

  it('removes incomplete temporary evidence and returns a sanitized failure', async () => {
    const report = await validReport();
    const fs = fileSystem();
    fs.writeFile.mockRejectedValueOnce(new Error('disk secret'));

    await expect(
      publishProposalLiveConformanceReport(
        report,
        REPORT_PATH,
        fs.seam,
        () => 'failed-write-token',
      ),
    ).rejects.toEqual(new ProposalLiveCommandError());
    expect(fs.unlink).toHaveBeenCalledWith(
      `${REPORT_PATH}.temporary-failed-write-token`,
    );
  });

  it('ignores absent temporary evidence and masks cleanup failure details', async () => {
    const report = await validReport();
    const absent = fileSystem();
    absent.rename.mockRejectedValueOnce(new Error('rename failed'));
    absent.unlink.mockRejectedValueOnce(
      Object.assign(new Error('absent'), { code: 'ENOENT' }),
    );
    await expect(
      publishProposalLiveConformanceReport(
        report,
        REPORT_PATH,
        absent.seam,
        () => 'absent-token',
      ),
    ).rejects.toBeInstanceOf(ProposalLiveCommandError);

    const cleanupFailure = fileSystem();
    cleanupFailure.rename.mockRejectedValueOnce(new Error('rename failed'));
    cleanupFailure.unlink.mockRejectedValueOnce(new Error('cleanup secret'));
    await expect(
      publishProposalLiveConformanceReport(
        report,
        REPORT_PATH,
        cleanupFailure.seam,
        () => 'cleanup-token',
      ),
    ).rejects.toEqual(new ProposalLiveCommandError());
  });

  it('publishes through the production file-system defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life-os-live-'));
    const path = join(directory, 'report.json');
    try {
      const report = await validReport();
      await publishProposalLiveConformanceReport(report, path);
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(report);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('live conformance command', () => {
  it('passes bounded environment evidence and publishes the returned report', async () => {
    const report = await validReport();
    const fs = fileSystem();
    const runner = vi.fn(
      async (
        _options: ProposalLiveConformanceOptions,
      ): Promise<ProposalLiveConformanceReport> => report,
    );

    await expect(
      runProposalQualityLiveCommand(environment(), {
        runConformance: runner,
        fileSystem: fs.seam,
        evaluationClock: () => EVALUATED_AT,
        monotonicClock: () => 42,
        uuidFactory: () => 'command-token',
      }),
    ).resolves.toBe(report);

    expect(runner).toHaveBeenCalledOnce();
    expect(runner.mock.calls[0]?.[0]).toMatchObject({
      lifeOsCommitSha: LIFE_OS_SHA,
      contextualOrchestratorCommitSha: ORCHESTRATOR_SHA,
      modelInventory: ['model-a', 'model-b'],
      evaluatedAt: EVALUATED_AT,
      providerCredentialAvailable: false,
    });
    expect(fs.rename).toHaveBeenCalledWith(
      `${REPORT_PATH}.temporary-command-token`,
      REPORT_PATH,
    );
  });

  it('does not parse or call provider configuration when explicitly disabled', async () => {
    const report = await validReport();
    const fs = fileSystem();
    const runner = vi.fn(
      async (
        input: ProposalLiveConformanceOptions,
      ): Promise<ProposalLiveConformanceReport> => {
        expect(input.modelInventory).toEqual([]);
        expect(input.providerCredentialAvailable).toBe(false);
        return report;
      },
    );

    await runProposalQualityLiveCommand(
      environment({
        AI_NIM_LIVE_CONFORMANCE_ENABLED: 'false',
        NVIDIA_NIM_CHAT_MODELS:
          'invalid model text that is deliberately ignored',
      }),
      {
        runConformance: runner,
        fileSystem: fs.seam,
        uuidFactory: () => 'disabled-token',
      },
    );
    expect(runner).toHaveBeenCalledOnce();
  });

  it('uses the environment timestamp and default current clock branches', async () => {
    const report = await validReport();
    const fs = fileSystem();
    const observed: ProposalLiveConformanceOptions[] = [];
    const runner = async (
      input: ProposalLiveConformanceOptions,
    ): Promise<ProposalLiveConformanceReport> => {
      observed.push(input);
      return report;
    };

    await runProposalQualityLiveCommand(environment(), {
      runConformance: runner,
      fileSystem: fs.seam,
      uuidFactory: () => 'timestamp-token',
    });
    await runProposalQualityLiveCommand(
      environment({ PROPOSAL_LIVE_EVALUATED_AT: undefined }),
      {
        runConformance: runner,
        fileSystem: fs.seam,
        uuidFactory: () => 'clock-token',
      },
    );
    expect(observed[0]?.evaluatedAt.toISOString()).toBe(
      EVALUATED_AT.toISOString(),
    );
    expect(observed[1]?.evaluatedAt).toBeInstanceOf(Date);
    expect(Number.isNaN(observed[1]?.evaluatedAt.getTime())).toBe(false);
  });

  it.each([
    {},
    environment({ PROPOSAL_LIVE_REPORT_PATH: '' }),
    environment({ PROPOSAL_LIVE_REPORT_PATH: 'relative/report.json' }),
    environment({ PROPOSAL_LIVE_REPORT_PATH: ' /tmp/report.json' }),
    environment({ PROPOSAL_LIVE_REPORT_PATH: '/tmp/report.json\n' }),
    environment({ PROPOSAL_LIVE_REPORT_PATH: `/${'x'.repeat(4_097)}` }),
    environment({ NVIDIA_NIM_CHAT_MODELS: 'bad model' }),
  ])('rejects invalid command environment %#', async (value) => {
    await expect(
      runProposalQualityLiveCommand(value, {
        runConformance: async () => await validReport(),
        fileSystem: fileSystem().seam,
      }),
    ).rejects.toBeInstanceOf(ProposalLiveCommandError);
  });

  it('sanitizes report generation and publication failures', async () => {
    await expect(
      runProposalQualityLiveCommand(environment(), {
        runConformance: async () => {
          throw new Error('provider secret');
        },
        fileSystem: fileSystem().seam,
      }),
    ).rejects.toEqual(new ProposalLiveCommandError());

    const fs = fileSystem();
    fs.writeFile.mockRejectedValueOnce(new ProposalLiveCommandError());
    await expect(
      runProposalQualityLiveCommand(environment(), {
        runConformance: async () => await validReport(),
        fileSystem: fs.seam,
        uuidFactory: () => 'publication-token',
      }),
    ).rejects.toEqual(new ProposalLiveCommandError());
  });
});
