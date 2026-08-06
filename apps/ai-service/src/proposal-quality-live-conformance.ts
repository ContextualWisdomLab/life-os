import { createHash } from 'node:crypto';
import {
  ContextualOrchestratorLiveProposalModel,
  createContextualOrchestratorLiveConfiguration,
  type LiveConformanceFailureCode,
  type LiveConformanceObservation,
  type LiveConformanceProfile,
  type LiveConformanceUsage,
} from './contextual-orchestrator-live-model';
import type { ContextualOrchestratorFetch } from './contextual-orchestrator-proposal-model';
import {
  DEFAULT_PROPOSAL_EVALUATION_FIXTURES,
  PROPOSAL_EVALUATION_SUITE_VERSION,
} from './proposal-quality-fixtures';
import {
  ProposalQualityEvaluator,
  type ProposalQualityRates,
  type ProposalQualityReport,
} from './proposal-quality-evaluation';

/** Versioned schema identifier for retained live-conformance evidence. */
export const LIVE_CONFORMANCE_SCHEMA =
  'life-os.ai-proposal-live-conformance.v1' as const;

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;
const MODEL_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const MAXIMUM_MODELS = 4;
const MAXIMUM_LIMITATIONS = 20;
const MAXIMUM_LIMITATION_LENGTH = 500;
const EVALUATION_WORKSPACE_ID = '20000000-0000-4000-8000-000000000001';
const PROFILE_PROPOSAL_IDS = Object.freeze({
  route_low: '20000000-0000-4000-8000-000000000002',
  route_high: '20000000-0000-4000-8000-000000000003',
  conduct_template: '20000000-0000-4000-8000-000000000004',
});
const AVAILABLE_PROFILES = Object.freeze([
  Object.freeze({
    profileId: 'route_low',
    mode: 'route',
    structuredOutput: true,
    reasoningEffort: 'low',
  }),
  Object.freeze({
    profileId: 'route_high',
    mode: 'route',
    structuredOutput: true,
    reasoningEffort: 'high',
  }),
  Object.freeze({
    profileId: 'conduct_template',
    mode: 'conduct',
    structuredOutput: false,
    reasoningEffort: null,
  }),
] satisfies readonly LiveConformanceProfile[]);
const UNSUPPORTED_PROFILE_IDS = Object.freeze([
  'conduct_generated',
  'conduct_without_verifier',
]);
const PRIMARY_RATE_KEYS = Object.freeze([
  'validProposalRate',
  'operationConformanceRate',
  'targetGroundingRate',
  'forbiddenTextPassRate',
  'benignUtilityRate',
  'promptInjectionResistanceRate',
] satisfies readonly (keyof ProposalQualityRates)[]);
const DEFAULT_LIMITATIONS = Object.freeze([
  'Live results are dated evidence for one NVIDIA model inventory, one fixture-suite version, and two exact repository commits.',
  'The seven-fixture suite cannot establish general model superiority, fairness, production reliability, or causal benefit from orchestration.',
  'The pinned contextual-orchestrator does not expose safe per-run generated-workflow, verifier-removal, or role-sensitive reasoning controls; those cells remain explicit unsupported evidence.',
  'Single-route cells use provider-native structured output while conducted cells rely on JSON-only instructions plus independent LifeOS validation; this is a recorded transport confound.',
  'Latency and provider token use are retained for capacity review but are not the optimization objective of this quality-first evaluation.',
]);

/** Stable high-level state for one complete live-conformance report. */
export type ProposalLiveConformanceStatus =
  'completed' | 'partial' | 'not_run' | 'failed';

/** Stable profile-level state for completed or unavailable evidence. */
export type ProposalLiveProfileStatus =
  'completed' | 'completed_with_failures' | 'unavailable';

/** Stable reasons why a profile or complete run did not produce live quality evidence. */
export type ProposalLiveUnavailableCode =
  | LiveConformanceFailureCode
  | 'missing_provider_credential'
  | 'missing_model_inventory'
  | 'invalid_configuration'
  | 'unsupported_by_pinned_orchestrator'
  | 'insufficient_model_inventory';

/** Aggregate credential-free orchestration measurements for one profile. */
export interface ProposalLiveObservationSummary {
  readonly callCount: number;
  readonly completedCalls: number;
  readonly failedCalls: number;
  readonly workflowDepthMaximum: number;
  readonly roleCounts: Readonly<Record<string, number>>;
  readonly contributingSteps: number;
  readonly verifierObservedCalls: number;
  readonly acceptedVerifierCalls: number;
  readonly rejectedVerifierCalls: number;
  readonly accessEdgeCount: number;
  readonly maximumAccessFanIn: number;
  readonly maximumDistinctAgents: number;
  readonly elapsedMilliseconds: number;
  readonly failureCodes: readonly LiveConformanceFailureCode[];
}

/** Aggregate provider counters for one profile, null when never reported. */
export interface ProposalLiveUsageTotals {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly reasoningTokens: number | null;
}

/** Metric deltas from the strong `route_high` baseline. */
export type ProposalLiveRateDeltas = Readonly<
  Record<keyof ProposalQualityRates, number | null>
>;

/** Completed quality and orchestration evidence for one profile. */
export interface ProposalLiveCompletedProfile {
  readonly profileId: string;
  readonly status: 'completed' | 'completed_with_failures';
  readonly quality: ProposalQualityReport;
  readonly observations: ProposalLiveObservationSummary;
  readonly usage: ProposalLiveUsageTotals;
  readonly rateDeltasFromBaseline: ProposalLiveRateDeltas;
}

/** Explicit unavailable profile cell without fabricated rates. */
export interface ProposalLiveUnavailableProfile {
  readonly profileId: string;
  readonly status: 'unavailable';
  readonly unavailableCode: ProposalLiveUnavailableCode;
}

/** One available or unavailable live-conformance profile cell. */
export type ProposalLiveProfile =
  ProposalLiveCompletedProfile | ProposalLiveUnavailableProfile;

/** Recommendation derived only from completed baseline and conduct evidence. */
export interface ProposalLiveRecommendation {
  readonly recommendedProfileId: 'route_high' | 'conduct_template';
  readonly conductRecommended: boolean;
  readonly rationaleCode:
    | 'conduct_quality_gain_without_safety_regression'
    | 'route_baseline_retained'
    | 'insufficient_comparable_evidence';
}

/** Immutable credential-free live-conformance report. */
export interface ProposalLiveConformanceReport {
  readonly schema: typeof LIVE_CONFORMANCE_SCHEMA;
  readonly status: ProposalLiveConformanceStatus;
  readonly lifeOsCommitSha: string;
  readonly contextualOrchestratorCommitSha: string;
  readonly suiteVersion: string;
  readonly evaluatedAt: string;
  readonly providerOriginLabel: 'nvidia_nim_hosted';
  readonly modelInventoryDigest: string | null;
  readonly modelCount: number;
  readonly baselineProfileId: 'route_high';
  readonly profiles: readonly ProposalLiveProfile[];
  readonly recommendation: ProposalLiveRecommendation;
  readonly limitations: readonly string[];
}

/** Configuration and deterministic seams for one live-conformance run. */
export interface ProposalLiveConformanceOptions {
  readonly lifeOsCommitSha: string;
  readonly contextualOrchestratorCommitSha: string;
  readonly modelInventory: readonly string[];
  readonly evaluatedAt: Date;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly providerCredentialAvailable: boolean;
  readonly fetcher?: ContextualOrchestratorFetch;
  readonly monotonicClock?: () => number;
}

/** Stable validation failure for malformed retained live evidence. */
export class ProposalLiveConformanceError extends Error {
  /** Creates one credential-free report validation failure. */
  constructor() {
    super('Proposal live conformance evidence is invalid');
    this.name = 'ProposalLiveConformanceError';
  }
}

/** Raises one stable live-report validation failure. */
function invalid(): never {
  throw new ProposalLiveConformanceError();
}

/** Requires one bounded non-empty trimmed string. */
function requireString(
  value: unknown,
  maximumLength: number,
  pattern?: RegExp,
): string {
  if (typeof value !== 'string' || value.trim() !== value || value === '') {
    return invalid();
  }
  if (value.length > maximumLength || (pattern && !pattern.test(value))) {
    return invalid();
  }
  return value;
}

/** Requires one exact lowercase commit SHA. */
function requireCommitSha(value: unknown): string {
  return requireString(value, 40, COMMIT_SHA_PATTERN);
}

/** Requires one valid UTC timestamp and returns its canonical spelling. */
function requireEvaluatedAt(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return invalid();
  }
  return value.toISOString();
}

/** Validates, deduplicates, and snapshots an explicit model inventory. */
function requireModelInventory(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > MAXIMUM_MODELS) {
    return invalid();
  }
  const models = values.map((value) =>
    requireString(value, 200, MODEL_IDENTIFIER_PATTERN),
  );
  if (new Set(models).size !== models.length) {
    return invalid();
  }
  return Object.freeze(models);
}

/** Hashes sorted model identifiers and discards their plaintext representation. */
function inventoryDigest(models: readonly string[]): string | null {
  return models.length === 0
    ? null
    : createHash('sha256')
        .update(JSON.stringify([...models].sort()), 'utf8')
        .digest('hex');
}

/** Sums optional provider counters while retaining null for entirely absent data. */
function sumUsage(
  observations: readonly LiveConformanceObservation[],
  key: keyof LiveConformanceUsage,
): number | null {
  const values = observations
    .map((item) => item.usage[key])
    .filter((value): value is number => value !== null);
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0);
}

/** Aggregates immutable orchestration observations without retaining model text. */
function summarizeObservations(
  observations: readonly LiveConformanceObservation[],
): ProposalLiveObservationSummary {
  const roleCounts: Record<string, number> = {};
  for (const item of observations) {
    for (const [role, count] of Object.entries(item.roleCounts)) {
      roleCounts[role] = (roleCounts[role] ?? 0) + count;
    }
  }
  const failureCodes = Object.freeze(
    [
      ...new Set(
        observations
          .map((item) => item.failureCode)
          .filter(
            (value): value is LiveConformanceFailureCode => value !== null,
          ),
      ),
    ].sort(),
  );
  return Object.freeze({
    callCount: observations.length,
    completedCalls: observations.filter((item) => item.failureCode === null)
      .length,
    failedCalls: observations.filter((item) => item.failureCode !== null)
      .length,
    workflowDepthMaximum: Math.max(
      0,
      ...observations.map((item) => item.workflowDepth),
    ),
    roleCounts: Object.freeze({ ...roleCounts }),
    contributingSteps: observations.reduce(
      (total, item) => total + item.contributingSteps,
      0,
    ),
    verifierObservedCalls: observations.filter((item) => item.verifierPresent)
      .length,
    acceptedVerifierCalls: observations.filter(
      (item) => item.verifierVerdict === 'accepted',
    ).length,
    rejectedVerifierCalls: observations.filter(
      (item) => item.verifierVerdict === 'rejected',
    ).length,
    accessEdgeCount: observations.reduce(
      (total, item) => total + item.accessEdgeCount,
      0,
    ),
    maximumAccessFanIn: Math.max(
      0,
      ...observations.map((item) => item.maximumAccessFanIn),
    ),
    maximumDistinctAgents: Math.max(
      0,
      ...observations.map((item) => item.distinctAgentCount),
    ),
    elapsedMilliseconds: observations.reduce(
      (total, item) => total + item.elapsedMilliseconds,
      0,
    ),
    failureCodes,
  });
}

/** Aggregates provider counters without retaining provider payloads. */
function summarizeUsage(
  observations: readonly LiveConformanceObservation[],
): ProposalLiveUsageTotals {
  return Object.freeze({
    promptTokens: sumUsage(observations, 'promptTokens'),
    completionTokens: sumUsage(observations, 'completionTokens'),
    totalTokens: sumUsage(observations, 'totalTokens'),
    reasoningTokens: sumUsage(observations, 'reasoningTokens'),
  });
}

/** Returns one metric delta while preserving undefined denominators. */
function delta(value: number | null, baseline: number | null): number | null {
  return value === null || baseline === null ? null : value - baseline;
}

/** Computes all rate deltas from the strong routed baseline. */
function rateDeltas(
  rates: ProposalQualityRates,
  baseline: ProposalQualityRates,
): ProposalLiveRateDeltas {
  const result = {} as Record<keyof ProposalQualityRates, number | null>;
  for (const key of PRIMARY_RATE_KEYS) {
    result[key] = delta(rates[key], baseline[key]);
  }
  return Object.freeze(result);
}

/** Returns zero deltas for the baseline itself. */
function baselineDeltas(rates: ProposalQualityRates): ProposalLiveRateDeltas {
  const result = {} as Record<keyof ProposalQualityRates, number | null>;
  for (const key of PRIMARY_RATE_KEYS) {
    result[key] = rates[key] === null ? null : 0;
  }
  return Object.freeze(result);
}

/** Returns a fixed unsupported profile cell. */
function unsupportedProfile(profileId: string): ProposalLiveUnavailableProfile {
  return Object.freeze({
    profileId,
    status: 'unavailable',
    unavailableCode: 'unsupported_by_pinned_orchestrator',
  });
}

/** Returns a fixed unavailable cell for a supported profile. */
function unavailableProfile(
  profileId: string,
  code: ProposalLiveUnavailableCode,
): ProposalLiveUnavailableProfile {
  return Object.freeze({
    profileId,
    status: 'unavailable',
    unavailableCode: code,
  });
}

/** Selects the initial run-wide no-result classification. */
function preflightUnavailableCode(
  options: ProposalLiveConformanceOptions,
  models: readonly string[],
): ProposalLiveUnavailableCode | undefined {
  if (!options.providerCredentialAvailable) {
    return 'missing_provider_credential';
  }
  if (models.length === 0) {
    return 'missing_model_inventory';
  }
  return undefined;
}

/** Runs one supported profile through the production evaluator. */
async function evaluateProfile(
  profile: LiveConformanceProfile,
  options: ProposalLiveConformanceOptions,
): Promise<{
  quality: ProposalQualityReport;
  observations: readonly LiveConformanceObservation[];
}> {
  const proposalId =
    PROFILE_PROPOSAL_IDS[
      profile.profileId as keyof typeof PROFILE_PROPOSAL_IDS
    ]!;
  const model = new ContextualOrchestratorLiveProposalModel(
    createContextualOrchestratorLiveConfiguration(options.environment, profile),
    options.fetcher,
    options.monotonicClock,
  );
  const evaluator = new ProposalQualityEvaluator(model, {
    workspaceId: EVALUATION_WORKSPACE_ID,
    proposalId,
    clock: () => options.evaluatedAt,
  });
  const quality = await evaluator.evaluate({
    suiteVersion: PROPOSAL_EVALUATION_SUITE_VERSION,
    modelLabel: profile.profileId,
    fixtures: DEFAULT_PROPOSAL_EVALUATION_FIXTURES,
  });
  return { quality, observations: model.observations() };
}

/** Finds one completed profile by identifier. */
function completedProfile(
  profiles: readonly ProposalLiveProfile[],
  profileId: string,
): ProposalLiveCompletedProfile | undefined {
  const profile = profiles.find((item) => item.profileId === profileId);
  return profile?.status === 'completed' ||
    profile?.status === 'completed_with_failures'
    ? profile
    : undefined;
}

/** Determines whether a comparable conduct cell merits recommendation. */
function recommendation(
  profiles: readonly ProposalLiveProfile[],
): ProposalLiveRecommendation {
  const baseline = completedProfile(profiles, 'route_high');
  const conduct = completedProfile(profiles, 'conduct_template');
  if (!baseline || !conduct) {
    return Object.freeze({
      recommendedProfileId: 'route_high',
      conductRecommended: false,
      rationaleCode: 'insufficient_comparable_evidence',
    });
  }
  const operationDelta =
    conduct.rateDeltasFromBaseline.operationConformanceRate;
  const injectionDelta =
    conduct.rateDeltasFromBaseline.promptInjectionResistanceRate;
  const hasSafetyRegression =
    (operationDelta !== null && operationDelta < 0) ||
    (injectionDelta !== null && injectionDelta < 0);
  const hasPrimaryGain = PRIMARY_RATE_KEYS.some((key) => {
    const value = conduct.rateDeltasFromBaseline[key];
    return value !== null && value > 0;
  });
  const recommendConduct = !hasSafetyRegression && hasPrimaryGain;
  return Object.freeze({
    recommendedProfileId: recommendConduct ? 'conduct_template' : 'route_high',
    conductRecommended: recommendConduct,
    rationaleCode: recommendConduct
      ? 'conduct_quality_gain_without_safety_regression'
      : 'route_baseline_retained',
  });
}

/** Calculates the report status from profile evidence and preflight state. */
function reportStatus(
  profiles: readonly ProposalLiveProfile[],
  preflightCode: ProposalLiveUnavailableCode | undefined,
): ProposalLiveConformanceStatus {
  if (preflightCode) {
    return 'not_run';
  }
  const baseline = completedProfile(profiles, 'route_high');
  if (!baseline) {
    return 'failed';
  }
  return profiles.some(
    (item) =>
      item.status === 'completed_with_failures' ||
      (item.status === 'unavailable' &&
        item.unavailableCode !== 'unsupported_by_pinned_orchestrator'),
  )
    ? 'partial'
    : 'completed';
}

/** Freezes the statically reviewed limitation statements. */
function limitations(): readonly string[] {
  return Object.freeze([...DEFAULT_LIMITATIONS]);
}

/**
 * Runs the available NVIDIA NIM profile cells through the production proposal
 * evaluator and returns a credential-free immutable report.
 */
export async function runProposalLiveConformance(
  options: ProposalLiveConformanceOptions,
): Promise<ProposalLiveConformanceReport> {
  const lifeOsCommitSha = requireCommitSha(options.lifeOsCommitSha);
  const contextualOrchestratorCommitSha = requireCommitSha(
    options.contextualOrchestratorCommitSha,
  );
  const evaluatedAt = requireEvaluatedAt(options.evaluatedAt);
  const models = requireModelInventory(options.modelInventory);
  const preflightCode = preflightUnavailableCode(options, models);
  const supportedProfiles: ProposalLiveProfile[] = [];

  if (preflightCode) {
    for (const profile of AVAILABLE_PROFILES) {
      supportedProfiles.push(
        unavailableProfile(profile.profileId, preflightCode),
      );
    }
  } else {
    for (const profile of AVAILABLE_PROFILES) {
      try {
        const result = await evaluateProfile(profile, options);
        const observations = summarizeObservations(result.observations);
        supportedProfiles.push(
          Object.freeze({
            profileId: profile.profileId,
            status:
              observations.failedCalls === 0
                ? 'completed'
                : 'completed_with_failures',
            quality: result.quality,
            observations,
            usage: summarizeUsage(result.observations),
            rateDeltasFromBaseline: Object.freeze({}) as ProposalLiveRateDeltas,
          }),
        );
      } catch {
        supportedProfiles.push(
          unavailableProfile(profile.profileId, 'invalid_configuration'),
        );
      }
    }
  }

  const baseline = completedProfile(supportedProfiles, 'route_high');
  const profilesWithDeltas: ProposalLiveProfile[] = supportedProfiles.map(
    (profile) => {
      if (
        profile.status !== 'completed' &&
        profile.status !== 'completed_with_failures'
      ) {
        return profile;
      }
      return Object.freeze({
        ...profile,
        rateDeltasFromBaseline:
          profile.profileId === 'route_high'
            ? baselineDeltas(profile.quality.rates)
            : rateDeltas(profile.quality.rates, baseline!.quality.rates),
      });
    },
  );
  profilesWithDeltas.push(...UNSUPPORTED_PROFILE_IDS.map(unsupportedProfile));
  const frozenProfiles = Object.freeze(profilesWithDeltas);
  const report = Object.freeze({
    schema: LIVE_CONFORMANCE_SCHEMA,
    status: reportStatus(frozenProfiles, preflightCode),
    lifeOsCommitSha,
    contextualOrchestratorCommitSha,
    suiteVersion: PROPOSAL_EVALUATION_SUITE_VERSION,
    evaluatedAt,
    providerOriginLabel: 'nvidia_nim_hosted' as const,
    modelInventoryDigest: inventoryDigest(models),
    modelCount: models.length,
    baselineProfileId: 'route_high' as const,
    profiles: frozenProfiles,
    recommendation: recommendation(frozenProfiles),
    limitations: limitations(),
  });
  return validateProposalLiveConformanceReport(report);
}

/** Requires one exact object key set. */
function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    invalid();
  }
}

/** Requires a non-array JSON record. */
function record(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : invalid();
}

/** Validates the retained top-level evidence contract before publication. */
export function validateProposalLiveConformanceReport(
  value: unknown,
): ProposalLiveConformanceReport {
  const report = record(value);
  requireExactKeys(report, [
    'schema',
    'status',
    'lifeOsCommitSha',
    'contextualOrchestratorCommitSha',
    'suiteVersion',
    'evaluatedAt',
    'providerOriginLabel',
    'modelInventoryDigest',
    'modelCount',
    'baselineProfileId',
    'profiles',
    'recommendation',
    'limitations',
  ]);
  if (
    report.schema !== LIVE_CONFORMANCE_SCHEMA ||
    !['completed', 'partial', 'not_run', 'failed'].includes(
      String(report.status),
    ) ||
    report.providerOriginLabel !== 'nvidia_nim_hosted' ||
    report.baselineProfileId !== 'route_high' ||
    !Number.isSafeInteger(report.modelCount) ||
    (report.modelCount as number) < 0 ||
    (report.modelCount as number) > MAXIMUM_MODELS ||
    (report.modelInventoryDigest !== null &&
      (typeof report.modelInventoryDigest !== 'string' ||
        !SHA_256_PATTERN.test(report.modelInventoryDigest))) ||
    !Array.isArray(report.profiles) ||
    report.profiles.length !==
      AVAILABLE_PROFILES.length + UNSUPPORTED_PROFILE_IDS.length ||
    !Array.isArray(report.limitations) ||
    report.limitations.length === 0 ||
    report.limitations.length > MAXIMUM_LIMITATIONS ||
    report.limitations.some(
      (item) =>
        typeof item !== 'string' ||
        item.length === 0 ||
        item.length > MAXIMUM_LIMITATION_LENGTH,
    )
  ) {
    return invalid();
  }
  requireCommitSha(report.lifeOsCommitSha);
  requireCommitSha(report.contextualOrchestratorCommitSha);
  requireString(report.suiteVersion, 128);
  const timestamp = requireString(report.evaluatedAt, 64);
  let canonicalTimestamp: string;
  try {
    canonicalTimestamp = new Date(timestamp).toISOString();
  } catch {
    return invalid();
  }
  if (canonicalTimestamp !== timestamp) {
    return invalid();
  }
  const profileIds = report.profiles.map((item) => {
    const profile = record(item);
    return requireString(profile.profileId, 64, PROFILE_ID_PATTERN);
  });
  if (new Set(profileIds).size !== profileIds.length) {
    return invalid();
  }
  const recommendationValue = record(report.recommendation);
  requireExactKeys(recommendationValue, [
    'recommendedProfileId',
    'conductRecommended',
    'rationaleCode',
  ]);
  if (
    (recommendationValue.recommendedProfileId !== 'route_high' &&
      recommendationValue.recommendedProfileId !== 'conduct_template') ||
    typeof recommendationValue.conductRecommended !== 'boolean' ||
    ![
      'conduct_quality_gain_without_safety_regression',
      'route_baseline_retained',
      'insufficient_comparable_evidence',
    ].includes(String(recommendationValue.rationaleCode))
  ) {
    return invalid();
  }
  return Object.freeze(value as ProposalLiveConformanceReport);
}
