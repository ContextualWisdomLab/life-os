import {
  CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA,
  CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SYSTEM_INSTRUCTION,
  parseContextualOrchestratorProposalCompletion,
  ProposalModelTransportError,
  type ContextualOrchestratorFetch,
} from './contextual-orchestrator-proposal-model';
import type {
  ProposalModel,
  ProposalModelDraft,
  ProposalRequest,
} from './proposal-service';

const DEFAULT_TIMEOUT_MILLISECONDS = 30_000;
const MINIMUM_TIMEOUT_MILLISECONDS = 100;
const MAXIMUM_TIMEOUT_MILLISECONDS = 120_000;
const MINIMUM_TOKEN_BYTES = 32;
const MAXIMUM_TOKEN_BYTES = 4_096;
const MAXIMUM_RESPONSE_BYTES = 65_536;
const MAXIMUM_TRACE_STEPS = 32;
const MAXIMUM_ACCESS_EDGES = 256;
const MAXIMUM_COUNTER_VALUE = 1_000_000_000;
const ROLE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;
const PROFILE_ID_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;

/** Available live-conformance orchestration modes on the pinned orchestrator. */
export type LiveConformanceMode = 'route' | 'conduct';

/** Reasoning levels projected only through supported single-route passthrough. */
export type LiveConformanceReasoningEffort = 'low' | 'high' | null;

/** Stable live-profile configuration used for one fixture suite cell. */
export interface LiveConformanceProfile {
  readonly profileId: string;
  readonly mode: LiveConformanceMode;
  readonly structuredOutput: boolean;
  readonly reasoningEffort: LiveConformanceReasoningEffort;
}

/** Credential-free failure classification retained by live evidence. */
export type LiveConformanceFailureCode =
  'orchestrator_unavailable' | 'provider_unavailable' | 'evaluation_failed';

/** Bounded provider usage measurements retained without request or response text. */
export interface LiveConformanceUsage {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly reasoningTokens: number | null;
}

/** Sanitized orchestration measurements for one proposal-generation call. */
export interface LiveConformanceObservation {
  readonly profileId: string;
  readonly mode: LiveConformanceMode;
  readonly workflowDepth: number;
  readonly roleCounts: Readonly<Record<string, number>>;
  readonly contributingSteps: number;
  readonly verifierPresent: boolean;
  readonly verifierVerdict: 'accepted' | 'rejected' | 'unknown' | null;
  readonly accessEdgeCount: number;
  readonly maximumAccessFanIn: number;
  readonly distinctAgentCount: number;
  readonly planSource:
    'template' | 'generated' | 'template_fallback' | 'unknown';
  readonly elapsedMilliseconds: number;
  readonly usage: LiveConformanceUsage;
  readonly failureCode: LiveConformanceFailureCode | null;
}

/** Immutable loopback configuration for the ephemeral live-conformance server. */
export interface ContextualOrchestratorLiveConfiguration {
  readonly origin: string;
  readonly token: string;
  readonly timeoutMilliseconds: number;
  readonly profile: LiveConformanceProfile;
}

/** Bounded environment accepted by the live-only composition root. */
type LiveModelEnvironment = Readonly<Record<string, string | undefined>>;

/** Monotonic clock seam used to measure transport duration deterministically. */
export type LiveConformanceMonotonicClock = () => number;

/** Sanitized live-model failure that retains only one stable classification. */
export class LiveConformanceModelError extends Error {
  /** Creates one stable failure without nested provider or response details. */
  constructor(readonly code: LiveConformanceFailureCode) {
    super('Live proposal conformance model is unavailable');
    this.name = 'LiveConformanceModelError';
  }
}

/** Raises one sanitized live-model failure. */
function fail(code: LiveConformanceFailureCode): never {
  throw new LiveConformanceModelError(code);
}

/** Requires one exact loopback HTTP origin for the ephemeral orchestrator. */
function requireLoopbackOrigin(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() !== value || value === '') {
    return fail('orchestrator_unavailable');
  }
  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    return fail('orchestrator_unavailable');
  }
  const port = Number(origin.port);
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== '' ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return fail('orchestrator_unavailable');
  }
  return origin.href;
}

/** Requires one bounded inference token without HTTP header delimiters. */
function requireToken(value: string | undefined): string {
  if (typeof value !== 'string' || value.trim() !== value) {
    return fail('orchestrator_unavailable');
  }
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (
    byteLength < MINIMUM_TOKEN_BYTES ||
    byteLength > MAXIMUM_TOKEN_BYTES ||
    /[\r\n\u0000]/u.test(value)
  ) {
    return fail('orchestrator_unavailable');
  }
  return value;
}

/** Requires one inclusive bounded request timeout. */
function requireTimeout(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return DEFAULT_TIMEOUT_MILLISECONDS;
  }
  const timeout = Number(value);
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < MINIMUM_TIMEOUT_MILLISECONDS ||
    timeout > MAXIMUM_TIMEOUT_MILLISECONDS
  ) {
    return fail('orchestrator_unavailable');
  }
  return timeout;
}

/** Validates and freezes one supported live evaluation profile. */
export function validateLiveConformanceProfile(
  value: LiveConformanceProfile,
): LiveConformanceProfile {
  if (
    typeof value !== 'object' ||
    value === null ||
    !PROFILE_ID_PATTERN.test(value.profileId) ||
    (value.mode !== 'route' && value.mode !== 'conduct') ||
    typeof value.structuredOutput !== 'boolean' ||
    (value.reasoningEffort !== null &&
      value.reasoningEffort !== 'low' &&
      value.reasoningEffort !== 'high') ||
    (value.mode === 'conduct' &&
      (value.structuredOutput || value.reasoningEffort !== null)) ||
    (value.mode === 'route' &&
      (!value.structuredOutput || value.reasoningEffort === null))
  ) {
    return fail('orchestrator_unavailable');
  }
  return Object.freeze({ ...value });
}

/** Parses and freezes the complete live-only model configuration. */
export function createContextualOrchestratorLiveConfiguration(
  environment: LiveModelEnvironment,
  profile: LiveConformanceProfile,
): ContextualOrchestratorLiveConfiguration {
  return Object.freeze({
    origin: requireLoopbackOrigin(environment.CONTEXTUAL_ORCHESTRATOR_LIVE_URL),
    token: requireToken(environment.CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN),
    timeoutMilliseconds: requireTimeout(
      environment.AI_LIVE_MODEL_REQUEST_TIMEOUT_MS,
    ),
    profile: validateLiveConformanceProfile(profile),
  });
}

/** Requires an untrusted value to be one non-array JSON record. */
function requireRecord(
  value: unknown,
): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

/** Returns one safe nonnegative integer measurement or null when absent. */
function optionalCounter(value: unknown): number | null {
  return Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= MAXIMUM_COUNTER_VALUE
    ? (value as number)
    : null;
}

/** Parses provider usage without retaining provider-specific response data. */
function parseUsage(
  envelope: Readonly<Record<string, unknown>>,
): LiveConformanceUsage {
  const usage = requireRecord(envelope.usage);
  const completionDetails = requireRecord(usage?.completion_tokens_details);
  return Object.freeze({
    promptTokens: optionalCounter(usage?.prompt_tokens),
    completionTokens: optionalCounter(usage?.completion_tokens),
    totalTokens: optionalCounter(usage?.total_tokens),
    reasoningTokens:
      optionalCounter(completionDetails?.reasoning_tokens) ??
      optionalCounter(usage?.reasoning_tokens),
  });
}

/** Maps an untrusted plan source into the fixed evidence vocabulary. */
function parsePlanSource(
  value: unknown,
): LiveConformanceObservation['planSource'] {
  return value === 'template' ||
    value === 'generated' ||
    value === 'template_fallback'
    ? value
    : 'unknown';
}

/** Classifies verifier output without retaining the output itself. */
function verifierVerdict(
  output: unknown,
): LiveConformanceObservation['verifierVerdict'] {
  if (typeof output !== 'string' || output.trim() === '') {
    return 'unknown';
  }
  const normalized = output.normalize('NFKC').toLowerCase();
  if (
    /\b(reject|rejected|disagree|conflict|unsafe|fail|failed|error|risky)\b/u.test(
      normalized,
    )
  ) {
    return 'rejected';
  }
  if (
    /\b(accept|accepted|verified|confirmed|pass|passed|good|ok)\b/u.test(
      normalized,
    )
  ) {
    return 'accepted';
  }
  return 'unknown';
}

/** Parses one bounded trace into aggregate measurements only. */
function parseTrace(
  value: unknown,
): Omit<
  LiveConformanceObservation,
  | 'profileId'
  | 'mode'
  | 'planSource'
  | 'elapsedMilliseconds'
  | 'usage'
  | 'failureCode'
> {
  if (!Array.isArray(value)) {
    return Object.freeze({
      workflowDepth: 0,
      roleCounts: Object.freeze({}),
      contributingSteps: 0,
      verifierPresent: false,
      verifierVerdict: null,
      accessEdgeCount: 0,
      maximumAccessFanIn: 0,
      distinctAgentCount: 0,
    });
  }
  if (value.length > MAXIMUM_TRACE_STEPS) {
    return fail('evaluation_failed');
  }
  const roleCounts: Record<string, number> = {};
  const agentIdentifiers = new Set<string>();
  let contributingSteps = 0;
  let verifierPresent = false;
  let observedVerifierVerdict: LiveConformanceObservation['verifierVerdict'] =
    null;
  let accessEdgeCount = 0;
  let maximumAccessFanIn = 0;
  for (const item of value) {
    const step = requireRecord(item);
    const role = step?.role;
    const agentId = step?.agent_id;
    const access = step?.access;
    if (
      !step ||
      typeof role !== 'string' ||
      !ROLE_PATTERN.test(role) ||
      typeof agentId !== 'string' ||
      agentId.trim() === '' ||
      agentId.length > 128 ||
      !Array.isArray(access) ||
      access.some(
        (entry) => !Number.isSafeInteger(entry) || (entry as number) < 0,
      )
    ) {
      return fail('evaluation_failed');
    }
    accessEdgeCount += access.length;
    if (accessEdgeCount > MAXIMUM_ACCESS_EDGES) {
      return fail('evaluation_failed');
    }
    maximumAccessFanIn = Math.max(maximumAccessFanIn, access.length);
    roleCounts[role] = (roleCounts[role] ?? 0) + 1;
    agentIdentifiers.add(agentId);
    if (typeof step.output === 'string' && step.output.trim() !== '') {
      contributingSteps += 1;
    }
    if (role === 'verifier') {
      verifierPresent = true;
      observedVerifierVerdict = verifierVerdict(step.output);
    }
  }
  return Object.freeze({
    workflowDepth: value.length,
    roleCounts: Object.freeze({ ...roleCounts }),
    contributingSteps,
    verifierPresent,
    verifierVerdict: observedVerifierVerdict,
    accessEdgeCount,
    maximumAccessFanIn,
    distinctAgentCount: agentIdentifiers.size,
  });
}

/** Reads one bounded response with fatal UTF-8 decoding. */
async function boundedResponseText(response: Response): Promise<string> {
  if (!response.ok || response.body === null) {
    return fail(
      response.status === 429 || response.status >= 500
        ? 'provider_unavailable'
        : 'orchestrator_unavailable',
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }
      totalBytes += result.value.byteLength;
      if (totalBytes > MAXIMUM_RESPONSE_BYTES) {
        await reader.cancel();
        return fail('evaluation_failed');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return fail('evaluation_failed');
  }
}

/** Builds the profile-specific OpenAI-compatible request body. */
function requestBody(
  profile: LiveConformanceProfile,
  input: ProposalRequest,
): string {
  const base = {
    model: 'contextual-orchestrator',
    orchestration_mode: profile.mode,
    include_orchestration_trace: true,
    temperature: 0,
    stream: false,
    messages: [
      {
        role: 'system',
        content: CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SYSTEM_INSTRUCTION,
      },
      { role: 'user', content: JSON.stringify(input) },
    ],
  };
  return JSON.stringify(
    profile.structuredOutput
      ? {
          ...base,
          reasoning_effort: profile.reasoningEffort,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'life_os_inert_proposal_draft',
              strict: true,
              schema: CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA,
            },
          },
        }
      : base,
  );
}

/** Freezes one successful or failed observation for later aggregation. */
function observation(
  profile: LiveConformanceProfile,
  mode: LiveConformanceMode,
  trace: ReturnType<typeof parseTrace>,
  planSource: LiveConformanceObservation['planSource'],
  elapsedMilliseconds: number,
  usage: LiveConformanceUsage,
  failureCode: LiveConformanceFailureCode | null,
): LiveConformanceObservation {
  return Object.freeze({
    profileId: profile.profileId,
    mode,
    ...trace,
    planSource,
    elapsedMilliseconds,
    usage,
    failureCode,
  });
}

/** Empty measurements used when transport fails before a valid response exists. */
function emptyTrace(): ReturnType<typeof parseTrace> {
  return parseTrace(undefined);
}

/** Empty usage used when no trustworthy provider counters are available. */
function emptyUsage(): LiveConformanceUsage {
  return Object.freeze({
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    reasoningTokens: null,
  });
}

/**
 * Calls one loopback contextual-orchestrator profile and retains only bounded
 * measurements alongside the independently validated proposal draft.
 */
export class ContextualOrchestratorLiveProposalModel implements ProposalModel {
  private readonly recordedObservations: LiveConformanceObservation[] = [];

  /** Creates one live model over immutable configuration and deterministic seams. */
  constructor(
    private readonly configuration: ContextualOrchestratorLiveConfiguration,
    private readonly fetcher: ContextualOrchestratorFetch = fetch,
    private readonly monotonicClock: LiveConformanceMonotonicClock = () =>
      performance.now(),
  ) {}

  /** Returns an immutable snapshot without exposing mutable internal storage. */
  observations(): readonly LiveConformanceObservation[] {
    return Object.freeze([...this.recordedObservations]);
  }

  /** Generates one inert draft and records only credential-free measurements. */
  async generate(input: ProposalRequest): Promise<ProposalModelDraft> {
    const startedAt = this.monotonicClock();
    try {
      const response = await this.fetcher(
        new URL('/v1/chat/completions', this.configuration.origin),
        {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${this.configuration.token}`,
            'content-type': 'application/json',
          },
          body: requestBody(this.configuration.profile, input),
          signal: AbortSignal.timeout(this.configuration.timeoutMilliseconds),
        },
      );
      const text = await boundedResponseText(response);
      let envelope: Readonly<Record<string, unknown>>;
      try {
        const parsed = JSON.parse(text) as unknown;
        const record = requireRecord(parsed);
        if (!record) {
          return fail('evaluation_failed');
        }
        envelope = record;
      } catch (error) {
        if (error instanceof LiveConformanceModelError) {
          throw error;
        }
        return fail('evaluation_failed');
      }
      const orchestration = requireRecord(envelope.orchestration);
      const trace = parseTrace(orchestration?.trace);
      const observedMode =
        orchestration?.mode === 'route' || orchestration?.mode === 'conduct'
          ? orchestration.mode
          : this.configuration.profile.mode;
      const elapsed = this.monotonicClock() - startedAt;
      if (!Number.isFinite(elapsed) || elapsed < 0) {
        return fail('evaluation_failed');
      }
      this.recordedObservations.push(
        observation(
          this.configuration.profile,
          observedMode,
          trace,
          parsePlanSource(orchestration?.plan_source),
          elapsed,
          parseUsage(envelope),
          null,
        ),
      );
      try {
        return parseContextualOrchestratorProposalCompletion(text);
      } catch (error) {
        if (error instanceof ProposalModelTransportError) {
          return fail('evaluation_failed');
        }
        throw error;
      }
    } catch (error) {
      const code =
        error instanceof LiveConformanceModelError
          ? error.code
          : 'orchestrator_unavailable';
      const elapsed = this.monotonicClock() - startedAt;
      this.recordedObservations.push(
        observation(
          this.configuration.profile,
          this.configuration.profile.mode,
          emptyTrace(),
          'unknown',
          Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : 0,
          emptyUsage(),
          code,
        ),
      );
      throw new LiveConformanceModelError(code);
    }
  }
}
