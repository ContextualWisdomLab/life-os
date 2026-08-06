import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  ContextualOrchestratorLiveProposalModel,
  createContextualOrchestratorLiveConfiguration,
  type LiveConformanceProfile,
} from './contextual-orchestrator-live-model';
import type { ContextualOrchestratorFetch } from './contextual-orchestrator-proposal-model';
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
import type { ProposalRequest } from './proposal-service';

const LIFE_OS_SHA = 'a'.repeat(40);
const ORCHESTRATOR_SHA = 'b'.repeat(40);
const TOKEN = Buffer.alloc(32, 0x59).toString('base64url');
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const EVALUATED_AT = new Date('2026-08-06T08:00:00.000Z');
const ROUTE_HIGH: LiveConformanceProfile = {
  profileId: 'route_high',
  mode: 'route',
  structuredOutput: true,
  reasoningEffort: 'high',
};
const REQUEST: ProposalRequest = {
  objective: 'Verify the production conformance path.',
  context: [
    {
      id: TASK_ID,
      kind: 'task',
      title: 'Review live conformance evidence',
      status: 'active',
    },
  ],
};

/** Creates one valid contextual-orchestrator proposal response. */
function proposalResponse(): Response {
  return Response.json({
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary: 'Review the live conformance evidence.',
            rationale: ['The active task is directly grounded in the request.'],
            operations: [
              {
                kind: 'prioritize_item',
                targetId: TASK_ID,
                description: 'Prioritize the live conformance evidence review.',
              },
            ],
          }),
        },
      },
    ],
    orchestration: { mode: 'route', plan_source: 'unknown' },
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      completion_tokens_details: { reasoning_tokens: 4 },
    },
  });
}

/** Returns a valid no-provider report for command publication tests. */
async function noProviderReport(): Promise<ProposalLiveConformanceReport> {
  return await runProposalLiveConformance({
    lifeOsCommitSha: LIFE_OS_SHA,
    contextualOrchestratorCommitSha: ORCHESTRATOR_SHA,
    modelInventory: [],
    evaluatedAt: EVALUATED_AT,
    providerCredentialAvailable: false,
    environment: {},
  });
}

/** Creates a side-effect-free publication boundary. */
function memoryFileSystem(): ProposalLiveCommandFileSystem {
  return {
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    unlink: vi.fn(async () => undefined),
  };
}

describe('live conformance production branch coverage', () => {
  it('uses the production monotonic clock when no test clock is supplied', async () => {
    const fetcher = vi.fn<ContextualOrchestratorFetch>(
      async () => proposalResponse(),
    );
    const model = new ContextualOrchestratorLiveProposalModel(
      createContextualOrchestratorLiveConfiguration(
        {
          CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
          CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
        },
        ROUTE_HIGH,
      ),
      fetcher,
    );

    await expect(model.generate(REQUEST)).resolves.toMatchObject({
      summary: 'Review the live conformance evidence.',
    });
    expect(model.observations()).toHaveLength(1);
    expect(model.observations()[0]?.elapsedMilliseconds).toBeGreaterThanOrEqual(
      0,
    );
  });

  it('passes a live credential state and injected transport through the command', async () => {
    const report = await noProviderReport();
    const fetcher = vi.fn<ContextualOrchestratorFetch>(
      async () => proposalResponse(),
    );
    let observed: ProposalLiveConformanceOptions | undefined;

    await runProposalQualityLiveCommand(
      {
        AI_NIM_LIVE_CONFORMANCE_ENABLED: 'true',
        NVIDIA_NIM_API_KEY_AVAILABLE: 'true',
        NVIDIA_NIM_CHAT_MODELS: 'meta/live-model',
        LIFE_OS_COMMIT_SHA: LIFE_OS_SHA,
        CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA: ORCHESTRATOR_SHA,
        CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
        CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
        PROPOSAL_LIVE_REPORT_PATH: '/tmp/life-os-live-coverage.json',
      },
      {
        fetcher,
        monotonicClock: () => 7,
        evaluationClock: () => EVALUATED_AT,
        fileSystem: memoryFileSystem(),
        uuidFactory: () => 'coverage-token',
        runConformance: async (options) => {
          observed = options;
          return report;
        },
      },
    );

    expect(observed).toMatchObject({
      providerCredentialAvailable: true,
      modelInventory: ['meta/live-model'],
      evaluatedAt: EVALUATED_AT,
    });
    expect(observed?.fetcher).toBe(fetcher);
    expect(observed?.monotonicClock?.()).toBe(7);
  });

  it('uses the production evaluator, file system, clock, and UUID defaults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life-os-live-command-'));
    const reportPath = join(directory, 'report.json');
    try {
      const report = await runProposalQualityLiveCommand({
        AI_NIM_LIVE_CONFORMANCE_ENABLED: 'false',
        NVIDIA_NIM_API_KEY_AVAILABLE: 'false',
        LIFE_OS_COMMIT_SHA: LIFE_OS_SHA,
        CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA: ORCHESTRATOR_SHA,
        PROPOSAL_LIVE_REPORT_PATH: reportPath,
      });

      expect(report.status).toBe('not_run');
      expect(report.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
      expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(report);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('publishes a failed report when every configured profile is unavailable', async () => {
    const report = await runProposalLiveConformance({
      lifeOsCommitSha: LIFE_OS_SHA,
      contextualOrchestratorCommitSha: ORCHESTRATOR_SHA,
      modelInventory: ['meta/live-model'],
      evaluatedAt: EVALUATED_AT,
      providerCredentialAvailable: true,
      environment: {},
    });

    expect(report.status).toBe('failed');
    expect(report.recommendation.rationaleCode).toBe(
      'insufficient_comparable_evidence',
    );
    expect(
      report.profiles.filter((profile) => profile.status === 'unavailable'),
    ).toHaveLength(report.profiles.length);
  });

  it('rejects duplicate profile identifiers in retained evidence', async () => {
    const report = await noProviderReport();
    const mutable = JSON.parse(JSON.stringify(report)) as {
      profiles: Array<{ profileId: string }>;
    };
    mutable.profiles[1]!.profileId = mutable.profiles[0]!.profileId;

    expect(() => validateProposalLiveConformanceReport(mutable)).toThrow(
      ProposalLiveConformanceError,
    );
  });
});
