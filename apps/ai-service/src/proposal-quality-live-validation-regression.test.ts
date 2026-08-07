import { describe, expect, it } from 'vitest';
import {
  LIVE_CONFORMANCE_SCHEMA,
  ProposalLiveConformanceError,
  validateProposalLiveConformanceReport,
} from './proposal-quality-live-conformance';

const EVALUATED_AT = '2026-08-06T10:00:00.000Z';
const RATE_KEYS = [
  'validProposalRate',
  'operationConformanceRate',
  'targetGroundingRate',
  'forbiddenTextPassRate',
  'benignUtilityRate',
  'promptInjectionResistanceRate',
] as const;

/** Builds one exact completed profile accepted by the retained-report contract. */
function completedProfile(profileId: string): Record<string, unknown> {
  const rates = {
    validProposalRate: 1,
    operationConformanceRate: 1,
    targetGroundingRate: null,
    forbiddenTextPassRate: null,
    benignUtilityRate: 1,
    promptInjectionResistanceRate: null,
  };
  return {
    profileId,
    status: 'completed',
    quality: {
      suiteVersion: 'validator-regression.v1',
      modelLabel: profileId,
      evaluatedAt: EVALUATED_AT,
      counts: {
        totalCases: 1,
        benignCases: 1,
        promptInjectionCases: 0,
        validProposals: 1,
        operationConformantCases: 1,
        targetedOperations: 0,
        groundedTargetOperations: 0,
        forbiddenTextCases: 0,
        forbiddenTextPassedCases: 0,
        benignUtilityPassedCases: 1,
        promptInjectionResistancePassedCases: 0,
      },
      rates,
      cases: [
        {
          fixtureId: 'fixture_one',
          category: 'benign',
          failureCode: null,
          validProposal: true,
          operationConformant: true,
          targetedOperations: 0,
          groundedTargetOperations: 0,
          forbiddenTextPassed: null,
          benignUtilityPassed: true,
          promptInjectionResistancePassed: null,
        },
      ],
    },
    observations: {
      callCount: 1,
      completedCalls: 1,
      failedCalls: 0,
      workflowDepthMaximum: 0,
      roleCounts: {},
      contributingSteps: 0,
      verifierObservedCalls: 0,
      acceptedVerifierCalls: 0,
      rejectedVerifierCalls: 0,
      accessEdgeCount: 0,
      maximumAccessFanIn: 0,
      maximumDistinctAgents: 0,
      elapsedMilliseconds: 1,
      failureCodes: [],
    },
    usage: {
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      reasoningTokens: null,
    },
    rateDeltasFromBaseline: Object.fromEntries(
      RATE_KEYS.map((key) => [key, rates[key] === null ? null : 0]),
    ),
  };
}

/** Builds one complete retained report for mutation-based rejection evidence. */
function validReport(): Record<string, unknown> {
  return {
    schema: LIVE_CONFORMANCE_SCHEMA,
    status: 'completed',
    lifeOsCommitSha: 'a'.repeat(40),
    contextualOrchestratorCommitSha: 'b'.repeat(40),
    suiteVersion: 'validator-regression.v1',
    evaluatedAt: EVALUATED_AT,
    providerOriginLabel: 'nvidia_nim_hosted',
    modelInventoryDigest: 'c'.repeat(64),
    modelCount: 1,
    baselineProfileId: 'route_high',
    profiles: [
      completedProfile('route_low'),
      completedProfile('route_high'),
      completedProfile('conduct_template'),
      {
        profileId: 'conduct_generated',
        status: 'unavailable',
        unavailableCode: 'unsupported_by_pinned_orchestrator',
      },
      {
        profileId: 'conduct_without_verifier',
        status: 'unavailable',
        unavailableCode: 'unsupported_by_pinned_orchestrator',
      },
    ],
    recommendation: {
      recommendedProfileId: 'route_high',
      conductRecommended: false,
      rationaleCode: 'route_baseline_retained',
    },
    limitations: ['Bounded validator regression evidence.'],
  };
}

/** Returns one mutable deep clone of the valid retained report. */
function candidate(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(validReport())) as Record<string, unknown>;
}

/** Returns one completed profile from a mutable report. */
function completed(
  report: Record<string, unknown>,
  index = 0,
): Record<string, unknown> {
  return (report.profiles as Array<Record<string, unknown>>)[index]!;
}

/** Returns one unavailable profile from a mutable report. */
function unavailable(report: Record<string, unknown>): Record<string, unknown> {
  return (report.profiles as Array<Record<string, unknown>>)[3]!;
}

/** Returns the quality object for one mutable completed profile. */
function quality(report: Record<string, unknown>): Record<string, unknown> {
  return completed(report).quality as Record<string, unknown>;
}

/** Returns the first quality case for one mutable completed profile. */
function qualityCase(report: Record<string, unknown>): Record<string, unknown> {
  return (quality(report).cases as Array<Record<string, unknown>>)[0]!;
}

/** Returns the observation aggregate for one mutable completed profile. */
function observations(report: Record<string, unknown>): Record<string, unknown> {
  return completed(report).observations as Record<string, unknown>;
}

type Mutation = (report: Record<string, unknown>) => void;

const INVALID_MUTATIONS: ReadonlyArray<readonly [string, Mutation]> = [
  ['completed profile extra key', (report) => (completed(report).extra = true)],
  ['unknown profile status', (report) => (completed(report).status = 'unknown')],
  ['missing completed quality', (report) => (completed(report).quality = null)],
  ['missing completed observations', (report) => (completed(report).observations = null)],
  ['invalid completed usage shape', (report) => (completed(report).usage = {})],
  [
    'delta outside rate range',
    (report) => {
      const deltas = completed(report)
        .rateDeltasFromBaseline as Record<string, unknown>;
      deltas.validProposalRate = 2;
    },
  ],
  [
    'unavailable profile extra key',
    (report) => (unavailable(report).extra = true),
  ],
  [
    'missing unavailable code',
    (report) => delete unavailable(report).unavailableCode,
  ],
  [
    'unknown unavailable code',
    (report) => (unavailable(report).unavailableCode = 'private_failure'),
  ],
  ['quality extra key', (report) => (quality(report).extra = true)],
  ['quality label mismatch', (report) => (quality(report).modelLabel = 'route_high')],
  [
    'quality noncanonical timestamp',
    (report) => (quality(report).evaluatedAt = '2026-08-06T10:00:00Z'),
  ],
  [
    'negative quality count',
    (report) => {
      const counts = quality(report).counts as Record<string, unknown>;
      counts.totalCases = -1;
    },
  ],
  [
    'noninteger quality count',
    (report) => {
      const counts = quality(report).counts as Record<string, unknown>;
      counts.totalCases = 1.5;
    },
  ],
  [
    'invalid required quality rate',
    (report) => {
      const rates = quality(report).rates as Record<string, unknown>;
      rates.validProposalRate = null;
    },
  ],
  [
    'quality rate above one',
    (report) => {
      const rates = quality(report).rates as Record<string, unknown>;
      rates.operationConformanceRate = 1.1;
    },
  ],
  [
    'quality case count mismatch',
    (report) => (quality(report).cases as unknown[]).pop(),
  ],
  [
    'quality case collection over limit',
    (report) => {
      const item = qualityCase(report);
      quality(report).cases = Array.from({ length: 101 }, () => ({ ...item }));
      const counts = quality(report).counts as Record<string, unknown>;
      counts.totalCases = 101;
    },
  ],
  ['quality case extra key', (report) => (qualityCase(report).extra = true)],
  ['quality case invalid category', (report) => (qualityCase(report).category = 'other')],
  [
    'quality case invalid failure code',
    (report) => (qualityCase(report).failureCode = 'provider_secret'),
  ],
  [
    'quality case invalid boolean',
    (report) => (qualityCase(report).validProposal = 'yes'),
  ],
  [
    'quality case grounded count exceeds targeted count',
    (report) => {
      qualityCase(report).targetedOperations = 0;
      qualityCase(report).groundedTargetOperations = 1;
    },
  ],
  [
    'quality case invalid nullable boolean',
    (report) => (qualityCase(report).forbiddenTextPassed = 'yes'),
  ],
  ['observation extra key', (report) => (observations(report).extra = true)],
  [
    'negative observation count',
    (report) => (observations(report).callCount = -1),
  ],
  [
    'noninteger observation count',
    (report) => (observations(report).contributingSteps = 0.5),
  ],
  [
    'negative elapsed duration',
    (report) => (observations(report).elapsedMilliseconds = -1),
  ],
  [
    'invalid observation role name',
    (report) => {
      (observations(report).roleCounts as Record<string, unknown>)['Bad Role'] = 1;
    },
  ],
  [
    'invalid observation role count',
    (report) => {
      (observations(report).roleCounts as Record<string, unknown>).worker = 0;
    },
  ],
  [
    'completed and failed calls do not equal call count',
    (report) => (observations(report).completedCalls = 2),
  ],
  [
    'verifier verdict counts exceed observed calls',
    (report) => {
      observations(report).acceptedVerifierCalls = 1;
      observations(report).verifierObservedCalls = 0;
    },
  ],
  [
    'failure codes are not an array',
    (report) => (observations(report).failureCodes = 'provider_unavailable'),
  ],
  [
    'failure codes contain duplicates',
    (report) => {
      observations(report).failureCodes = [
        'provider_unavailable',
        'provider_unavailable',
      ];
    },
  ],
  [
    'failure codes contain an unknown value',
    (report) => (observations(report).failureCodes = ['private_failure']),
  ],
  [
    'usage counter is negative',
    (report) => {
      const usage = completed(report).usage as Record<string, unknown>;
      usage.promptTokens = -1;
    },
  ],
  [
    'usage counter is fractional',
    (report) => {
      const usage = completed(report).usage as Record<string, unknown>;
      usage.totalTokens = 1.5;
    },
  ],
  [
    'delta is nonfinite',
    (report) => {
      const deltas = completed(report)
        .rateDeltasFromBaseline as Record<string, unknown>;
      deltas.validProposalRate = Number.POSITIVE_INFINITY;
    },
  ],
  [
    'profile identifier is outside the fixed matrix',
    (report) => (unavailable(report).profileId = 'unknown_profile'),
  ],
  ['model count and digest disagree', (report) => (report.modelCount = 0)],
  [
    'nonempty inventory has no digest',
    (report) => (report.modelInventoryDigest = null),
  ],
];

describe('retained live-evidence profile validation', () => {
  it('accepts the exact complete retained profile matrix', () => {
    const report = validReport();
    expect(validateProposalLiveConformanceReport(report)).toBe(report);
  });

  it.each(INVALID_MUTATIONS)('rejects %s', (_label, mutate) => {
    const report = candidate();
    mutate(report);
    expect(() => validateProposalLiveConformanceReport(report)).toThrow(
      ProposalLiveConformanceError,
    );
  });
});
