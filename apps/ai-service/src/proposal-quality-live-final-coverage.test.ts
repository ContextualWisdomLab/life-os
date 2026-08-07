import { describe, expect, it, vi } from 'vitest';
import {
  runProposalQualityLiveCommand,
  type ProposalLiveCommandFileSystem,
} from './proposal-quality-live-command';
import {
  ProposalLiveConformanceError,
  runProposalLiveConformance,
  validateProposalLiveConformanceReport,
  type ProposalLiveConformanceOptions,
  type ProposalLiveConformanceReport,
} from './proposal-quality-live-conformance';

const LIFE_OS_SHA = 'a'.repeat(40);
const ORCHESTRATOR_SHA = 'b'.repeat(40);
const EVALUATED_AT = new Date('2026-08-06T08:00:00.000Z');

/** Creates one valid credential-free report without external provider traffic. */
async function validReport(): Promise<ProposalLiveConformanceReport> {
  return await runProposalLiveConformance({
    lifeOsCommitSha: LIFE_OS_SHA,
    contextualOrchestratorCommitSha: ORCHESTRATOR_SHA,
    modelInventory: [],
    evaluatedAt: EVALUATED_AT,
    providerCredentialAvailable: false,
    environment: {},
  });
}

/** Creates a no-I/O publication boundary for command option evidence. */
function memoryFileSystem(): ProposalLiveCommandFileSystem {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
  };
}

describe('final live conformance branch evidence', () => {
  it('normalizes absent commit metadata to bounded empty option values', async () => {
    const report = await validReport();
    let observed: ProposalLiveConformanceOptions | undefined;

    await runProposalQualityLiveCommand(
      {
        AI_NIM_LIVE_CONFORMANCE_ENABLED: 'false',
        NVIDIA_NIM_API_KEY_AVAILABLE: 'false',
        PROPOSAL_LIVE_REPORT_PATH: '/tmp/life-os-live-fallback.json',
      },
      {
        evaluationClock: () => EVALUATED_AT,
        fileSystem: memoryFileSystem(),
        uuidFactory: () => 'fallback-coverage-token',
        runConformance: async (options) => {
          observed = options;
          return report;
        },
      },
    );

    expect(observed?.lifeOsCommitSha).toBe('');
    expect(observed?.contextualOrchestratorCommitSha).toBe('');
  });

  it('rejects a parseable but non-canonical retained timestamp', async () => {
    const report = await validReport();
    const mutable = JSON.parse(JSON.stringify(report)) as {
      evaluatedAt: string;
    };
    mutable.evaluatedAt = '2026-08-06T08:00:00Z';

    expect(() => validateProposalLiveConformanceReport(mutable)).toThrow(
      ProposalLiveConformanceError,
    );
  });
});
