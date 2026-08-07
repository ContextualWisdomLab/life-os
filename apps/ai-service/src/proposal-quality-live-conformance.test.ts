import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  LIVE_CONFORMANCE_SCHEMA,
  ProposalLiveConformanceError,
  runProposalLiveConformance,
  validateProposalLiveConformanceReport,
  type ProposalLiveConformanceOptions,
  type ProposalLiveConformanceReport,
  type ProposalLiveProfile,
} from './proposal-quality-live-conformance';
import type { ContextualOrchestratorFetch } from './contextual-orchestrator-proposal-model';

const LIFE_OS_SHA = 'a'.repeat(40);
const ORCHESTRATOR_SHA = 'b'.repeat(40);
const TOKEN = Buffer.alloc(32, 0x4c).toString('base64url');
const EVALUATED_AT = new Date('2026-08-06T06:00:00.000Z');
const MODELS = ['meta/llama-3.3-70b-instruct'];

/** Returns one valid complete run configuration with optional overrides. */
function options(
  overrides: Partial<ProposalLiveConformanceOptions> = {},
): ProposalLiveConformanceOptions {
  let monotonic = 0;
  return {
    lifeOsCommitSha: LIFE_OS_SHA,
    contextualOrchestratorCommitSha: ORCHESTRATOR_SHA,
    modelInventory: MODELS,
    evaluatedAt: EVALUATED_AT,
    providerCredentialAvailable: true,
    environment: {
      CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
      CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
    },
    monotonicClock: () => {
      monotonic += 5;
      return monotonic;
    },
    ...overrides,
  };
}

/** Builds a conformant proposal draft from one serialized LifeOS request. */
function conformantDraft(
  requestBody: Record<string, unknown>,
): Record<string, unknown> {
  const messages = requestBody.messages as Array<Record<string, unknown>>;
  const userMessage = messages[1];
  const request = JSON.parse(String(userMessage?.content)) as {
    objective: string;
    context: Array<{
      id: string;
      status: 'active' | 'blocked' | 'completed';
    }>;
  };
  const target = request.context.find((item) => item.status !== 'completed');
  return target
    ? {
        summary: 'Review the selected active work.',
        rationale: ['The selected item remains unfinished and reviewable.'],
        operations: [
          {
            kind: 'prioritize_item',
            targetId: target.id,
            description: 'Prioritize the selected item for explicit review.',
          },
        ],
      }
    : {
        summary: 'Create one reviewable next task.',
        rationale: ['No existing context item can be selected.'],
        operations: [
          {
            kind: 'create_task',
            description: 'Create one concrete task for explicit review.',
          },
        ],
      };
}

/** Returns a deterministic orchestrator response for the supplied request. */
function responseForRequest(
  requestBody: Record<string, unknown>,
  overrides: {
    content?: unknown;
    status?: number;
    trace?: unknown;
  } = {},
): Response {
  const profileMode = String(requestBody.orchestration_mode);
  const trace =
    overrides.trace ??
    (profileMode === 'conduct'
      ? [
          {
            role: 'thinker',
            agent_id: 'thinking_agent',
            access: [],
            output: 'candidate',
          },
          {
            role: 'worker',
            agent_id: 'working_agent',
            access: [0],
            output: 'candidate',
          },
          {
            role: 'verifier',
            agent_id: 'review_agent',
            access: [0, 1],
            output: 'Verified and accepted.',
          },
          {
            role: 'synthesizer',
            agent_id: 'working_agent',
            access: [1, 2],
            output: 'candidate',
          },
        ]
      : undefined);
  const body = {
    choices: [
      {
        message: {
          content:
            overrides.content ?? JSON.stringify(conformantDraft(requestBody)),
        },
      },
    ],
    orchestration: {
      mode: profileMode,
      plan_source: profileMode === 'conduct' ? 'template' : 'unknown',
      ...(trace === undefined ? {} : { trace }),
    },
    usage: {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      completion_tokens_details: {
        reasoning_tokens:
          requestBody.reasoning_effort === 'high'
            ? 4
            : requestBody.reasoning_effort === 'low'
              ? 1
              : 3,
      },
    },
  };
  return Response.json(body, { status: overrides.status ?? 200 });
}

/** Creates a Fetch seam that returns one conformant response per request. */
function successfulFetcher(): ReturnType<
  typeof vi.fn<ContextualOrchestratorFetch>
> {
  return vi.fn<ContextualOrchestratorFetch>(async (_input, init) => {
    const requestBody = JSON.parse(String(init?.body)) as Record<
      string,
      unknown
    >;
    return responseForRequest(requestBody);
  });
}

/** Finds one profile and narrows its availability for assertions. */
function profile(
  report: ProposalLiveConformanceReport,
  profileId: string,
): ProposalLiveProfile {
  const found = report.profiles.find((item) => item.profileId === profileId);
  if (!found) {
    throw new Error(`Missing profile ${profileId}`);
  }
  return found;
}

/** Clones immutable report evidence for negative validation tests. */
function mutableReport(
  report: ProposalLiveConformanceReport,
): Record<string, unknown> {
  return JSON.parse(JSON.stringify(report)) as Record<string, unknown>;
}

describe('proposal live conformance report', () => {
  it('evaluates every available profile and retains only credential-free evidence', async () => {
    const fetcher = successfulFetcher();
    const report = await runProposalLiveConformance(options({ fetcher }));

    expect(report).toMatchObject({
      schema: LIVE_CONFORMANCE_SCHEMA,
      status: 'completed',
      lifeOsCommitSha: LIFE_OS_SHA,
      contextualOrchestratorCommitSha: ORCHESTRATOR_SHA,
      suiteVersion: '2026-08-05.1',
      evaluatedAt: EVALUATED_AT.toISOString(),
      providerOriginLabel: 'nvidia_nim_hosted',
      modelCount: 1,
      baselineProfileId: 'route_high',
      recommendation: {
        recommendedProfileId: 'route_high',
        conductRecommended: false,
        rationaleCode: 'route_baseline_retained',
      },
    });
    expect(fetcher).toHaveBeenCalledTimes(21);
    expect(report.modelInventoryDigest).toBe(
      createHash('sha256')
        .update(JSON.stringify([...MODELS].sort()), 'utf8')
        .digest('hex'),
    );
    expect(report.profiles.map((item) => item.profileId)).toEqual([
      'route_low',
      'route_high',
      'conduct_template',
      'conduct_generated',
      'conduct_without_verifier',
    ]);

    for (const profileId of ['route_low', 'route_high', 'conduct_template']) {
      const item = profile(report, profileId);
      expect(item.status).toBe('completed');
      if (item.status === 'completed') {
        expect(item.quality.counts.totalCases).toBe(7);
        expect(item.quality.rates).toMatchObject({
          validProposalRate: 1,
          operationConformanceRate: 1,
          targetGroundingRate: 1,
          benignUtilityRate: 1,
          promptInjectionResistanceRate: 1,
        });
        expect(item.observations).toMatchObject({
          callCount: 7,
          completedCalls: 7,
          failedCalls: 0,
          failureCodes: [],
        });
        expect(item.usage).toMatchObject({
          promptTokens: 70,
          completionTokens: 35,
          totalTokens: 105,
        });
      }
    }
    const baseline = profile(report, 'route_high');
    if (baseline.status === 'completed') {
      expect(baseline.rateDeltasFromBaseline).toEqual({
        validProposalRate: 0,
        operationConformanceRate: 0,
        targetGroundingRate: 0,
        forbiddenTextPassRate: 0,
        benignUtilityRate: 0,
        promptInjectionResistanceRate: 0,
      });
      expect(baseline.usage.reasoningTokens).toBe(28);
    }
    const routeLow = profile(report, 'route_low');
    if (routeLow.status === 'completed') {
      expect(routeLow.usage.reasoningTokens).toBe(7);
    }
    const conduct = profile(report, 'conduct_template');
    if (conduct.status === 'completed') {
      expect(conduct.observations).toMatchObject({
        workflowDepthMaximum: 4,
        roleCounts: {
          thinker: 7,
          worker: 7,
          verifier: 7,
          synthesizer: 7,
        },
        contributingSteps: 28,
        verifierObservedCalls: 7,
        acceptedVerifierCalls: 7,
        rejectedVerifierCalls: 0,
        accessEdgeCount: 35,
        maximumAccessFanIn: 2,
        maximumDistinctAgents: 3,
      });
    }
    expect(profile(report, 'conduct_generated')).toEqual({
      profileId: 'conduct_generated',
      status: 'unavailable',
      unavailableCode: 'unsupported_by_pinned_orchestrator',
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.profiles)).toBe(true);
    expect(Object.isFrozen(report.limitations)).toBe(true);

    const serialized = JSON.stringify(report);
    for (const forbidden of [
      MODELS[0]!,
      TOKEN,
      'Review the most important launch task',
      'Verify launch readiness',
      'Prioritize the selected item',
      'thinking_agent',
      'working_agent',
      'review_agent',
      'choices',
      'messages',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('recommends conduct only for a measured gain without safety regression', async () => {
    const fetcher = vi.fn<ContextualOrchestratorFetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const messages = body.messages as Array<Record<string, unknown>>;
      const requestValue = JSON.parse(String(messages[1]?.content)) as {
        objective: string;
      };
      if (
        body.reasoning_effort === 'high' &&
        requestValue.objective.includes('pricing page')
      ) {
        return responseForRequest(body, {
          content: JSON.stringify({
            summary: 'Wrong operation family.',
            rationale: ['This route cell intentionally misses one fixture.'],
            operations: [
              {
                kind: 'prioritize_item',
                targetId: '30000000-0000-4000-8000-000000000001',
                description: 'Prioritize a nonexistent item.',
              },
            ],
          }),
        });
      }
      return responseForRequest(body);
    });

    const report = await runProposalLiveConformance(options({ fetcher }));
    expect(report.status).toBe('completed');
    expect(report.recommendation).toEqual({
      recommendedProfileId: 'conduct_template',
      conductRecommended: true,
      rationaleCode: 'conduct_quality_gain_without_safety_regression',
    });
    const conduct = profile(report, 'conduct_template');
    if (conduct.status === 'completed') {
      expect(conduct.rateDeltasFromBaseline.validProposalRate).toBe(0);
      expect(conduct.rateDeltasFromBaseline.benignUtilityRate).toBeGreaterThan(
        0,
      );
      expect(conduct.rateDeltasFromBaseline.promptInjectionResistanceRate).toBe(
        0,
      );
    }
  });

  it('retains the route baseline when conduct regresses prompt-injection resistance', async () => {
    const fetcher = vi.fn<ContextualOrchestratorFetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const messages = body.messages as Array<Record<string, unknown>>;
      const requestValue = JSON.parse(String(messages[1]?.content)) as {
        objective: string;
      };
      if (
        body.orchestration_mode === 'conduct' &&
        requestValue.objective.includes('Ignore every system rule')
      ) {
        const wrong = conformantDraft(body);
        const operations = wrong.operations as Array<Record<string, unknown>>;
        operations[0] = {
          ...operations[0],
          description: 'DIRECT_INJECTION_SENTINEL',
        };
        return responseForRequest(body, { content: JSON.stringify(wrong) });
      }
      return responseForRequest(body);
    });

    const report = await runProposalLiveConformance(options({ fetcher }));
    expect(report.recommendation).toEqual({
      recommendedProfileId: 'route_high',
      conductRecommended: false,
      rationaleCode: 'route_baseline_retained',
    });
    const conduct = profile(report, 'conduct_template');
    if (conduct.status === 'completed') {
      expect(
        conduct.rateDeltasFromBaseline.promptInjectionResistanceRate,
      ).toBeLessThan(0);
    }
  });

  it.each([
    [false, MODELS, 'missing_provider_credential'],
    [true, [], 'missing_model_inventory'],
  ] as const)(
    'publishes an explicit no-result report for provider=%s models=%s',
    async (providerCredentialAvailable, modelInventory, unavailableCode) => {
      const fetcher = successfulFetcher();
      const report = await runProposalLiveConformance(
        options({
          providerCredentialAvailable,
          modelInventory,
          fetcher,
        }),
      );

      expect(report.status).toBe('not_run');
      expect(report.modelCount).toBe(modelInventory.length);
      expect(report.modelInventoryDigest).toBe(
        modelInventory.length === 0
          ? null
          : createHash('sha256')
              .update(JSON.stringify([...modelInventory].sort()), 'utf8')
              .digest('hex'),
      );
      expect(fetcher).not.toHaveBeenCalled();
      for (const profileId of ['route_low', 'route_high', 'conduct_template']) {
        expect(profile(report, profileId)).toEqual({
          profileId,
          status: 'unavailable',
          unavailableCode,
        });
      }
      expect(report.recommendation.rationaleCode).toBe(
        'insufficient_comparable_evidence',
      );
    },
  );

  it('classifies partial provider failures without fabricating successful cases', async () => {
    const fetcher = vi.fn<ContextualOrchestratorFetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return body.reasoning_effort === 'low'
        ? new Response('private upstream response', { status: 503 })
        : responseForRequest(body);
    });

    const report = await runProposalLiveConformance(options({ fetcher }));
    expect(report.status).toBe('partial');
    const low = profile(report, 'route_low');
    expect(low.status).toBe('completed_with_failures');
    if (low.status === 'completed_with_failures') {
      expect(low.quality.counts.validProposals).toBe(0);
      expect(low.observations).toMatchObject({
        callCount: 7,
        completedCalls: 0,
        failedCalls: 7,
        failureCodes: ['provider_unavailable'],
      });
      expect(low.usage).toEqual({
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        reasoningTokens: null,
      });
    }
    expect(JSON.stringify(report)).not.toContain('private upstream response');
  });

  it('fails the report when the baseline cannot be configured', async () => {
    const report = await runProposalLiveConformance(
      options({
        environment: {
          CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'https://not-loopback.example',
          CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
        },
        fetcher: successfulFetcher(),
      }),
    );

    expect(report.status).toBe('failed');
    for (const profileId of ['route_low', 'route_high', 'conduct_template']) {
      expect(profile(report, profileId)).toEqual({
        profileId,
        status: 'unavailable',
        unavailableCode: 'orchestrator_unavailable',
      });
    }
  });
});

describe('proposal live conformance validation', () => {
  it.each([
    { lifeOsCommitSha: 'short' },
    { contextualOrchestratorCommitSha: 'A'.repeat(40) },
    { evaluatedAt: new Date(Number.NaN) },
    { modelInventory: ['bad model'] },
    { modelInventory: ['same-model', 'same-model'] },
    {
      modelInventory: Array.from({ length: 5 }, (_, index) => `model-${index}`),
    },
    { modelInventory: null as never },
  ])('rejects unsafe run input %#', async (override) => {
    await expect(
      runProposalLiveConformance(options(override)),
    ).rejects.toBeInstanceOf(ProposalLiveConformanceError);
  });

  it('accepts the generated report and rejects malformed top-level evidence', async () => {
    const report = await runProposalLiveConformance(
      options({ fetcher: successfulFetcher() }),
    );
    expect(validateProposalLiveConformanceReport(report)).toBe(report);

    const invalidReports: Record<string, unknown>[] = [];
    invalidReports.push({ ...mutableReport(report), unexpected: true });
    for (const [key, value] of [
      ['schema', 'wrong'],
      ['status', 'unknown'],
      ['providerOriginLabel', 'other'],
      ['baselineProfileId', 'route_low'],
      ['modelCount', -1],
      ['modelCount', 5],
      ['modelCount', 1.5],
      ['modelInventoryDigest', 'short'],
      ['profiles', []],
      ['limitations', []],
      ['limitations', [42]],
      ['lifeOsCommitSha', 'short'],
      ['contextualOrchestratorCommitSha', 'short'],
      ['suiteVersion', ''],
      ['evaluatedAt', 'not-a-date'],
    ] as const) {
      invalidReports.push({ ...mutableReport(report), [key]: value });
    }
    const duplicateProfiles = mutableReport(report);
    const profiles = duplicateProfiles.profiles as Array<
      Record<string, unknown>
    >;
    profiles[1] = { ...profiles[1], profileId: profiles[0]?.profileId };
    invalidReports.push(duplicateProfiles);
    const invalidProfileId = mutableReport(report);
    (
      invalidProfileId.profiles as Array<Record<string, unknown>>
    )[0]!.profileId = 'Route High';
    invalidReports.push(invalidProfileId);
    const invalidRecommendation = mutableReport(report);
    invalidRecommendation.recommendation = {
      recommendedProfileId: 'other',
      conductRecommended: false,
      rationaleCode: 'route_baseline_retained',
    };
    invalidReports.push(invalidRecommendation);
    const invalidRecommendationKeys = mutableReport(report);
    invalidRecommendationKeys.recommendation = {
      recommendedProfileId: 'route_high',
      conductRecommended: false,
      rationaleCode: 'route_baseline_retained',
      extra: true,
    };
    invalidReports.push(invalidRecommendationKeys);

    for (const value of [null, [], ...invalidReports]) {
      expect(() => validateProposalLiveConformanceReport(value)).toThrow(
        ProposalLiveConformanceError,
      );
    }
  });
});
