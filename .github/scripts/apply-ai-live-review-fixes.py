"""Apply the reviewed PR #117 live-conformance corrections atomically."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AI = ROOT / "apps/ai-service/src"


def read(path: str | Path) -> str:
    """Read one repository file as UTF-8."""

    return (ROOT / path if isinstance(path, str) else path).read_text(encoding="utf-8")


def write(path: str | Path, content: str) -> None:
    """Write one repository file as UTF-8."""

    target = ROOT / path if isinstance(path, str) else path
    target.write_text(content, encoding="utf-8")


def replace_once(path: str | Path, old: str, new: str, label: str) -> None:
    """Replace one exact block or fail before ambiguous mutation."""

    source = read(path)
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    write(path, source.replace(old, new, 1))


def repair_workflow() -> None:
    """Remove argv credentials, centralize the pin, and erase raw logs."""

    path = ".github/workflows/ai-proposal-live-conformance.yml"
    source = read(path)
    replacements = (
        (
            "          ref: 6841b71935e0b7cb98fb52bcb4709cc5100c8d87",
            "          ref: ${{ env.CONTEXTUAL_ORCHESTRATOR_COMMIT }}",
            "orchestrator checkout pin",
        ),
        (
            "            --inference-token \"$CONTEXTUAL_ORCHESTRATOR_INFERENCE_TOKEN\" \\\n            --admin-token \"$CONTEXTUAL_ORCHESTRATOR_ADMIN_TOKEN\" \\\n",
            "",
            "argv token removal",
        ),
        (
            "          CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA: 6841b71935e0b7cb98fb52bcb4709cc5100c8d87",
            "          CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA: ${{ env.CONTEXTUAL_ORCHESTRATOR_COMMIT }}",
            "report commit pin",
        ),
        (
            "            wait \"$pid\" 2>/dev/null || true\n          fi\n",
            "            wait \"$pid\" 2>/dev/null || true\n          fi\n          rm -f \"${RUNNER_TEMP}/contextual-orchestrator.log\"\n",
            "raw orchestrator log cleanup",
        ),
    )
    for old, new, label in replacements:
        count = source.count(old)
        if count != 1:
            raise SystemExit(f"{label}: expected one match, found {count}")
        source = source.replace(old, new, 1)
    write(path, source)


def repair_live_model() -> None:
    """Validate topology and response mode before recording evidence."""

    path = AI / "contextual-orchestrator-live-model.ts"
    source = read(path)
    source = source.replace(
        "  for (const item of value) {\n",
        "  for (const [stepIndex, item] of value.entries()) {\n",
        1,
    )
    old_validation = """      access.some(
        (entry) => !Number.isSafeInteger(entry) || (entry as number) < 0,
      )
    ) {
      return fail('evaluation_failed');
    }
    accessEdgeCount += access.length;
"""
    new_validation = """      access.some(
        (entry) =>
          !Number.isSafeInteger(entry) ||
          (entry as number) < 0 ||
          (entry as number) >= stepIndex,
      ) ||
      new Set(access as number[]).size !== access.length
    ) {
      return fail('evaluation_failed');
    }
    accessEdgeCount += access.length;
"""
    if source.count(old_validation) != 1:
        raise SystemExit("trace access validation: expected one match")
    source = source.replace(old_validation, new_validation, 1)
    old_mode = """      const orchestration = requireRecord(envelope.orchestration);
      const trace = parseTrace(orchestration?.trace);
      const observedMode =
        orchestration?.mode === 'route' || orchestration?.mode === 'conduct'
          ? orchestration.mode
          : this.configuration.profile.mode;
"""
    new_mode = """      const orchestration = requireRecord(envelope.orchestration);
      const responseMode =
        orchestration?.mode === 'route' || orchestration?.mode === 'conduct'
          ? orchestration.mode
          : undefined;
      if (
        responseMode !== undefined &&
        responseMode !== this.configuration.profile.mode
      ) {
        return fail('evaluation_failed');
      }
      const trace = parseTrace(orchestration?.trace);
      const observedMode = responseMode ?? this.configuration.profile.mode;
"""
    if source.count(old_mode) != 1:
        raise SystemExit("response mode validation: expected one match")
    write(path, source.replace(old_mode, new_mode, 1))


def repair_shared_schema() -> None:
    """Recursively freeze the shared structured-output schema."""

    path = AI / "contextual-orchestrator-proposal-model.ts"
    source = read(path)
    marker = "/** Strict proposal-draft schema shared by production and live evaluation. */\n"
    helper = """/** Recursively freezes one acyclic JSON-compatible contract value. */
function deepFreeze<T>(value: T): T {
  if (Object(value) !== value) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value) as T;
}

"""
    if source.count(marker) != 1:
        raise SystemExit("schema insertion marker: expected one match")
    source = source.replace(marker, helper + marker, 1)
    source = source.replace(
        "export const CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA = Object.freeze({",
        "export const CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA = deepFreeze({",
        1,
    )
    write(path, source)


def repair_conformance() -> None:
    """Preserve failure codes, handle missing baselines, and validate cells."""

    path = AI / "proposal-quality-live-conformance.ts"
    source = read(path)
    source = source.replace(
        "  type LiveConformanceFailureCode,\n",
        "  LiveConformanceModelError,\n  type LiveConformanceFailureCode,\n",
        1,
    )
    baseline_marker = """/** Returns zero deltas for the baseline itself. */
function baselineDeltas(rates: ProposalQualityRates): ProposalLiveRateDeltas {
  const result = {} as Record<keyof ProposalQualityRates, number | null>;
  for (const key of PRIMARY_RATE_KEYS) {
    result[key] = rates[key] === null ? null : 0;
  }
  return Object.freeze(result);
}
"""
    null_helper = baseline_marker + """
/** Returns undefined deltas when the strong baseline produced no evidence. */
function nullDeltas(): ProposalLiveRateDeltas {
  return Object.freeze(
    Object.fromEntries(PRIMARY_RATE_KEYS.map((key) => [key, null])),
  ) as ProposalLiveRateDeltas;
}
"""
    if source.count(baseline_marker) != 1:
        raise SystemExit("null delta insertion: expected one match")
    source = source.replace(baseline_marker, null_helper, 1)
    source = source.replace(
        """      } catch {
        supportedProfiles.push(
          unavailableProfile(profile.profileId, 'invalid_configuration'),
        );
      }
""",
        """      } catch (error) {
        supportedProfiles.push(
          unavailableProfile(
            profile.profileId,
            error instanceof LiveConformanceModelError
              ? error.code
              : 'invalid_configuration',
          ),
        );
      }
""",
        1,
    )
    source = source.replace(
        """          profile.profileId === 'route_high'
            ? baselineDeltas(profile.quality.rates)
            : rateDeltas(profile.quality.rates, baseline!.quality.rates),
""",
        """          profile.profileId === 'route_high'
            ? baselineDeltas(profile.quality.rates)
            : baseline
              ? rateDeltas(profile.quality.rates, baseline.quality.rates)
              : nullDeltas(),
""",
        1,
    )

    validator_start = source.index("/** Requires one exact object key set. */")
    validator = r'''/** Requires one exact object key set. */
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

/** Requires one bounded finite numeric evidence value. */
function numericEvidence(
  value: unknown,
  minimum: number,
  maximum: number,
  integer: boolean,
  nullable: boolean,
): number | null {
  if (value === null && nullable) {
    return null;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum ||
    (integer && !Number.isSafeInteger(value))
  ) {
    return invalid();
  }
  return value;
}

/** Requires one boolean or optional boolean evidence value. */
function booleanEvidence(value: unknown, nullable: boolean): boolean | null {
  if (value === null && nullable) {
    return null;
  }
  return typeof value === 'boolean' ? value : invalid();
}

/** Requires one canonical RFC 3339 instant. */
function canonicalTimestamp(value: unknown): string {
  const timestamp = requireString(value, 64);
  let canonical: string;
  try {
    canonical = new Date(timestamp).toISOString();
  } catch {
    return invalid();
  }
  return canonical === timestamp ? timestamp : invalid();
}

const QUALITY_COUNT_KEYS = Object.freeze([
  'totalCases',
  'benignCases',
  'promptInjectionCases',
  'validProposals',
  'operationConformantCases',
  'targetedOperations',
  'groundedTargetOperations',
  'forbiddenTextCases',
  'forbiddenTextPassedCases',
  'benignUtilityPassedCases',
  'promptInjectionResistancePassedCases',
]);
const QUALITY_CASE_KEYS = Object.freeze([
  'fixtureId',
  'category',
  'failureCode',
  'validProposal',
  'operationConformant',
  'targetedOperations',
  'groundedTargetOperations',
  'forbiddenTextPassed',
  'benignUtilityPassed',
  'promptInjectionResistancePassed',
]);
const OBSERVATION_KEYS = Object.freeze([
  'callCount',
  'completedCalls',
  'failedCalls',
  'workflowDepthMaximum',
  'roleCounts',
  'contributingSteps',
  'verifierObservedCalls',
  'acceptedVerifierCalls',
  'rejectedVerifierCalls',
  'accessEdgeCount',
  'maximumAccessFanIn',
  'maximumDistinctAgents',
  'elapsedMilliseconds',
  'failureCodes',
]);
const USAGE_KEYS = Object.freeze([
  'promptTokens',
  'completionTokens',
  'totalTokens',
  'reasoningTokens',
]);
const UNAVAILABLE_CODES = new Set<ProposalLiveUnavailableCode>([
  'orchestrator_unavailable',
  'provider_unavailable',
  'evaluation_failed',
  'missing_provider_credential',
  'missing_model_inventory',
  'invalid_configuration',
  'unsupported_by_pinned_orchestrator',
  'insufficient_model_inventory',
]);
const FAILURE_CODES = new Set<LiveConformanceFailureCode>([
  'orchestrator_unavailable',
  'provider_unavailable',
  'evaluation_failed',
]);
const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;

/** Validates one retained fixture result without accepting extra text fields. */
function validateQualityCase(value: unknown): void {
  const item = record(value);
  requireExactKeys(item, QUALITY_CASE_KEYS);
  requireString(item.fixtureId, 128, PROFILE_ID_PATTERN);
  if (item.category !== 'benign' && item.category !== 'prompt_injection') {
    invalid();
  }
  if (item.failureCode !== null && item.failureCode !== 'proposal_unavailable') {
    invalid();
  }
  booleanEvidence(item.validProposal, false);
  booleanEvidence(item.operationConformant, false);
  const targeted = numericEvidence(item.targetedOperations, 0, 1_000, true, false);
  const grounded = numericEvidence(
    item.groundedTargetOperations,
    0,
    1_000,
    true,
    false,
  );
  if ((grounded as number) > (targeted as number)) {
    invalid();
  }
  booleanEvidence(item.forbiddenTextPassed, true);
  booleanEvidence(item.benignUtilityPassed, true);
  booleanEvidence(item.promptInjectionResistancePassed, true);
}

/** Validates one immutable proposal-quality report retained inside a cell. */
function validateQuality(value: unknown, profileId: string): void {
  const quality = record(value);
  requireExactKeys(quality, [
    'suiteVersion',
    'modelLabel',
    'evaluatedAt',
    'counts',
    'rates',
    'cases',
  ]);
  requireString(quality.suiteVersion, 128);
  if (requireString(quality.modelLabel, 64, PROFILE_ID_PATTERN) !== profileId) {
    invalid();
  }
  canonicalTimestamp(quality.evaluatedAt);
  const counts = record(quality.counts);
  requireExactKeys(counts, QUALITY_COUNT_KEYS);
  for (const key of QUALITY_COUNT_KEYS) {
    numericEvidence(counts[key], 0, 1_000_000, true, false);
  }
  const rates = record(quality.rates);
  requireExactKeys(rates, PRIMARY_RATE_KEYS);
  numericEvidence(rates.validProposalRate, 0, 1, false, false);
  for (const key of PRIMARY_RATE_KEYS.slice(1)) {
    numericEvidence(rates[key], 0, 1, false, true);
  }
  if (
    !Array.isArray(quality.cases) ||
    quality.cases.length !== counts.totalCases ||
    quality.cases.length > 100
  ) {
    invalid();
  }
  quality.cases.forEach(validateQualityCase);
}

/** Validates one aggregate orchestration summary. */
function validateObservations(value: unknown): void {
  const observations = record(value);
  requireExactKeys(observations, OBSERVATION_KEYS);
  const integerKeys = OBSERVATION_KEYS.filter(
    (key) =>
      key !== 'roleCounts' &&
      key !== 'elapsedMilliseconds' &&
      key !== 'failureCodes',
  );
  for (const key of integerKeys) {
    numericEvidence(observations[key], 0, 1_000_000_000, true, false);
  }
  numericEvidence(
    observations.elapsedMilliseconds,
    0,
    Number.MAX_SAFE_INTEGER,
    false,
    false,
  );
  const roles = record(observations.roleCounts);
  for (const [role, count] of Object.entries(roles)) {
    if (!ROLE_NAME_PATTERN.test(role)) {
      invalid();
    }
    numericEvidence(count, 1, 1_000_000, true, false);
  }
  if (
    (observations.completedCalls as number) +
      (observations.failedCalls as number) !==
      observations.callCount ||
    (observations.acceptedVerifierCalls as number) +
      (observations.rejectedVerifierCalls as number) >
      (observations.verifierObservedCalls as number) ||
    !Array.isArray(observations.failureCodes) ||
    new Set(observations.failureCodes).size !== observations.failureCodes.length ||
    observations.failureCodes.some(
      (code) => typeof code !== 'string' || !FAILURE_CODES.has(code as LiveConformanceFailureCode),
    )
  ) {
    invalid();
  }
}

/** Validates nullable non-negative provider usage counters. */
function validateUsage(value: unknown): void {
  const usage = record(value);
  requireExactKeys(usage, USAGE_KEYS);
  for (const key of USAGE_KEYS) {
    numericEvidence(usage[key], 0, 1_000_000_000, true, true);
  }
}

/** Validates every primary metric delta. */
function validateDeltas(value: unknown): void {
  const deltas = record(value);
  requireExactKeys(deltas, PRIMARY_RATE_KEYS);
  for (const key of PRIMARY_RATE_KEYS) {
    numericEvidence(deltas[key], -1, 1, false, true);
  }
}

/** Validates one unavailable or completed profile cell. */
function validateProfileCell(value: unknown): string {
  const profile = record(value);
  const profileId = requireString(profile.profileId, 64, PROFILE_ID_PATTERN);
  if (profile.status === 'unavailable') {
    requireExactKeys(profile, ['profileId', 'status', 'unavailableCode']);
    if (
      typeof profile.unavailableCode !== 'string' ||
      !UNAVAILABLE_CODES.has(
        profile.unavailableCode as ProposalLiveUnavailableCode,
      )
    ) {
      invalid();
    }
    return profileId;
  }
  if (
    profile.status !== 'completed' &&
    profile.status !== 'completed_with_failures'
  ) {
    return invalid();
  }
  requireExactKeys(profile, [
    'profileId',
    'status',
    'quality',
    'observations',
    'usage',
    'rateDeltasFromBaseline',
  ]);
  validateQuality(profile.quality, profileId);
  validateObservations(profile.observations);
  validateUsage(profile.usage);
  validateDeltas(profile.rateDeltasFromBaseline);
  return profileId;
}

/** Validates the retained evidence contract before publication. */
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
    ((report.modelCount as number) === 0) !==
      (report.modelInventoryDigest === null) ||
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
  canonicalTimestamp(report.evaluatedAt);
  const profileIds = report.profiles.map(validateProfileCell);
  const expectedProfileIds = new Set([
    ...AVAILABLE_PROFILES.map((profile) => profile.profileId),
    ...UNSUPPORTED_PROFILE_IDS,
  ]);
  if (
    new Set(profileIds).size !== profileIds.length ||
    profileIds.some((profileId) => !expectedProfileIds.has(profileId))
  ) {
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
'''
    write(path, source[:validator_start] + validator)


def repair_command_publication() -> None:
    """Validate the actual temporary file before atomic publication."""

    path = AI / "proposal-quality-live-command.ts"
    source = read(path)
    source = source.replace(
        "import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';",
        "import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';",
        1,
    )
    source = source.replace(
        """  /** Atomically replaces the final report after validation. */
  readonly rename: (oldPath: string, newPath: string) => Promise<void>;
""",
        """  /** Reads the exact temporary report back before publication. */
  readonly readFile: (
    path: string,
    options: { readonly encoding: 'utf8' },
  ) => Promise<string>;
  /** Atomically replaces the final report after validation. */
  readonly rename: (oldPath: string, newPath: string) => Promise<void>;
""",
        1,
    )
    source = source.replace(
        "return Object.freeze({ mkdir, writeFile, rename, unlink });",
        "return Object.freeze({ mkdir, writeFile, readFile, rename, unlink });",
        1,
    )
    source = source.replace(
        """    const decoded = JSON.parse(payload) as unknown;
    validateProposalLiveConformanceReport(decoded);
""",
        """    const persisted = await fileSystem.readFile(temporaryPath, {
      encoding: 'utf8',
    });
    const decoded = JSON.parse(persisted) as unknown;
    validateProposalLiveConformanceReport(decoded);
""",
        1,
    )
    write(path, source)


def repair_tests() -> None:
    """Add regression evidence for every reviewed failure mode."""

    live_test = AI / "contextual-orchestrator-live-model.test.ts"
    source = read(live_test)
    unsafe_marker = """    [
      {
        role: 'worker',
        agent_id: 'worker_agent',
        access: Array.from({ length: 257 }, (_, index) => index),
        output: 'x',
      },
    ],
    [null],
"""
    unsafe_replacement = """    [
      {
        role: 'worker',
        agent_id: 'worker_agent',
        access: Array.from({ length: 257 }, (_, index) => index),
        output: 'x',
      },
    ],
    [
      { role: 'thinker', agent_id: 'a', access: [], output: 'x' },
      { role: 'worker', agent_id: 'b', access: [1], output: 'x' },
    ],
    [
      { role: 'thinker', agent_id: 'a', access: [], output: 'x' },
      { role: 'worker', agent_id: 'b', access: [999], output: 'x' },
    ],
    [
      { role: 'thinker', agent_id: 'a', access: [], output: 'x' },
      { role: 'worker', agent_id: 'b', access: [0, 0], output: 'x' },
    ],
    [null],
"""
    if source.count(unsafe_marker) != 1:
        raise SystemExit("unsafe trace cases: expected one match")
    source = source.replace(unsafe_marker, unsafe_replacement, 1)
    mode_marker = """  it('constructs with production defaults without I/O', () => {
"""
    mode_test = """  it('rejects a response mode that differs from the requested profile', async () => {
    const fixture = model(
      ROUTE_HIGH,
      response({ orchestration: { mode: 'conduct', trace: [] } }),
    );
    expect(await code(fixture.model.generate(REQUEST))).toBe(
      'evaluation_failed',
    );
    expect(fixture.model.observations()).toHaveLength(1);
    expect(fixture.model.observations()[0]?.failureCode).toBe(
      'evaluation_failed',
    );
  });

"""
    if source.count(mode_marker) != 1:
        raise SystemExit("mode mismatch test insertion: expected one match")
    write(live_test, source.replace(mode_marker, mode_test + mode_marker, 1))

    contract_test = AI / "contextual-orchestrator-proposal-contract.test.ts"
    source = read(contract_test)
    marker = """  it('parses one exact completion envelope into an untrusted proposal draft', () => {
"""
    deep_test = """  it('deep-freezes every nested structured-output schema value', () => {
    const variants =
      CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA.properties.operations.items.oneOf;
    expect(Object.isFrozen(CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA)).toBe(true);
    expect(Object.isFrozen(variants)).toBe(true);
    expect(Object.isFrozen(variants[0]?.properties.kind)).toBe(true);
    expect(() => {
      (
        variants[0]?.properties.kind as unknown as { const: string }
      ).const = 'execute_task';
    }).toThrow(TypeError);
  });

"""
    if source.count(marker) != 1:
        raise SystemExit("deep freeze test insertion: expected one match")
    write(contract_test, source.replace(marker, deep_test + marker, 1))

    command_test = AI / "proposal-quality-live-command.test.ts"
    source = read(command_test)
    source = source.replace(
        """  rename: ReturnType<typeof vi.fn<ProposalLiveCommandFileSystem['rename']>>;
""",
        """  readFile: ReturnType<
    typeof vi.fn<ProposalLiveCommandFileSystem['readFile']>
  >;
  rename: ReturnType<typeof vi.fn<ProposalLiveCommandFileSystem['rename']>>;
""",
        1,
    )
    source = source.replace(
        """  const writeFile = vi.fn<ProposalLiveCommandFileSystem['writeFile']>(
    async () => undefined,
  );
  const rename = vi.fn<ProposalLiveCommandFileSystem['rename']>(
""",
        """  let persisted = '';
  const writeFile = vi.fn<ProposalLiveCommandFileSystem['writeFile']>(
    async (_path, data) => {
      persisted = data;
    },
  );
  const readFile = vi.fn<ProposalLiveCommandFileSystem['readFile']>(
    async () => persisted,
  );
  const rename = vi.fn<ProposalLiveCommandFileSystem['rename']>(
""",
        1,
    )
    source = source.replace(
        """    seam: { mkdir, writeFile, rename, unlink },
    mkdir,
    writeFile,
    rename,
""",
        """    seam: { mkdir, writeFile, readFile, rename, unlink },
    mkdir,
    writeFile,
    readFile,
    rename,
""",
        1,
    )
    source = source.replace(
        """    expect(JSON.parse(String(payload))).toEqual(report);
    expect(fs.rename).toHaveBeenCalledWith(temporaryPath, REPORT_PATH);
""",
        """    expect(JSON.parse(String(payload))).toEqual(report);
    expect(fs.readFile).toHaveBeenCalledWith(temporaryPath, {
      encoding: 'utf8',
    });
    expect(fs.rename).toHaveBeenCalledWith(temporaryPath, REPORT_PATH);
""",
        1,
    )
    tamper_marker = """  it('removes incomplete temporary evidence and returns a sanitized failure', async () => {
"""
    tamper_test = """  it('rejects tampered temporary evidence before atomic rename', async () => {
    const report = await validReport();
    const fs = fileSystem();
    fs.readFile.mockResolvedValueOnce('{\"tampered\":true}');

    await expect(
      publishProposalLiveConformanceReport(
        report,
        REPORT_PATH,
        fs.seam,
        () => 'tampered-token',
      ),
    ).rejects.toEqual(new ProposalLiveCommandError());
    expect(fs.rename).not.toHaveBeenCalled();
    expect(fs.unlink).toHaveBeenCalledWith(
      `${REPORT_PATH}.temporary-tampered-token`,
    );
  });

"""
    if source.count(tamper_marker) != 1:
        raise SystemExit("tampered file test insertion: expected one match")
    write(command_test, source.replace(tamper_marker, tamper_test + tamper_marker, 1))

    for filename in [
        "proposal-quality-live-coverage.test.ts",
        "proposal-quality-live-final-coverage.test.ts",
    ]:
        path = AI / filename
        source = read(path)
        source = source.replace(
            """    writeFile: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
""",
            """    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => JSON.stringify(await noProviderReport())),
    rename: vi.fn(async () => undefined),
""",
            1,
        )
        write(path, source)

    conformance_test = AI / "proposal-quality-live-conformance.test.ts"
    source = read(conformance_test)
    source = source.replace(
        """        unavailableCode: 'invalid_configuration',
""",
        """        unavailableCode: 'orchestrator_unavailable',
""",
        3,
    )
    generic_marker = """  it('fails the report when the baseline cannot be configured', async () => {
"""
    generic_test = """  it('classifies unexpected evaluator setup failures as invalid configuration', async () => {
    const input = options({ fetcher: successfulFetcher() });
    Object.defineProperty(input, 'monotonicClock', {
      get() {
        throw new Error('private setup failure');
      },
    });
    const report = await runProposalLiveConformance(input);
    for (const profileId of ['route_low', 'route_high', 'conduct_template']) {
      expect(profile(report, profileId)).toEqual({
        profileId,
        status: 'unavailable',
        unavailableCode: 'invalid_configuration',
      });
    }
  });

"""
    if source.count(generic_marker) != 1:
        raise SystemExit("generic classification test insertion: expected one match")
    source = source.replace(generic_marker, generic_test + generic_marker, 1)
    validation_marker = """    const invalidRecommendation = mutableReport(report);
"""
    profile_validation = """    const invalidProfileValues = [
      ['status', 'unknown'],
      ['unavailableCode', 'unknown'],
      ['quality', null],
      ['observations', null],
      ['usage', { promptTokens: -1 }],
      ['rateDeltasFromBaseline', { validProposalRate: 2 }],
    ] as const;
    for (const [key, value] of invalidProfileValues) {
      const candidate = mutableReport(report);
      const cells = candidate.profiles as Array<Record<string, unknown>>;
      const index = key === 'unavailableCode' ? 3 : 0;
      cells[index] = { ...cells[index], [key]: value };
      invalidReports.push(candidate);
    }
    const invalidQualityCase = mutableReport(report);
    const completed = (
      invalidQualityCase.profiles as Array<Record<string, unknown>>
    )[0]!;
    const quality = completed.quality as Record<string, unknown>;
    const cases = quality.cases as Array<Record<string, unknown>>;
    cases[0] = { ...cases[0], operationConformant: 'yes' };
    invalidReports.push(invalidQualityCase);
    const invalidObservationInvariant = mutableReport(report);
    const observationProfile = (
      invalidObservationInvariant.profiles as Array<Record<string, unknown>>
    )[0]!;
    const observations = observationProfile.observations as Record<string, unknown>;
    observations.completedCalls = 999;
    invalidReports.push(invalidObservationInvariant);

"""
    if source.count(validation_marker) != 1:
        raise SystemExit("profile validation test insertion: expected one match")
    write(
        conformance_test,
        source.replace(validation_marker, profile_validation + validation_marker, 1),
    )

    workflow_test = AI / "proposal-quality-live-workflow.test.ts"
    source = read(workflow_test)
    source = source.replace(
        """    expect(workflow.match(new RegExp(ORCHESTRATOR_COMMIT, 'gu'))?.length).toBe(
      3,
    );
    expect(workflow).toContain(`ref: ${ORCHESTRATOR_COMMIT}`);
""",
        """    expect(workflow.match(new RegExp(ORCHESTRATOR_COMMIT, 'gu'))?.length).toBe(
      1,
    );
    expect(workflow).toContain(
      'ref: ${{ env.CONTEXTUAL_ORCHESTRATOR_COMMIT }}',
    );
    expect(workflow).toContain(
      'CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA: ${{ env.CONTEXTUAL_ORCHESTRATOR_COMMIT }}',
    );
""",
        1,
    )
    source = source.replace(
        """    expect(server).toContain('--inference-token');
    expect(server).toContain('--admin-token');
""",
        """    expect(server).not.toContain('--inference-token');
    expect(server).not.toContain('--admin-token');
    expect(workflow).toContain(
      "'CONTEXTUAL_ORCHESTRATOR_INFERENCE_TOKEN'",
    );
    expect(workflow).toContain("'CONTEXTUAL_ORCHESTRATOR_ADMIN_TOKEN'");
""",
        1,
    )
    cleanup_marker = """    expect(upload).not.toContain('temporary');
"""
    cleanup_test = cleanup_marker + """    expect(step('Stop the ephemeral orchestrator')).toContain(
      'rm -f \"${RUNNER_TEMP}/contextual-orchestrator.log\"',
    );
"""
    if source.count(cleanup_marker) != 1:
        raise SystemExit("cleanup workflow assertion: expected one match")
    write(workflow_test, source.replace(cleanup_marker, cleanup_test, 1))


def repair_docs() -> None:
    """Align ADR, plan, and research claims with reviewed evidence."""

    agents = "AGENTS.md"
    replace_once(
        agents,
        "Fugu, Conductor, TRINITY, and strong-single-agent evidence guide the design, but repository tests and retained measurements determine the deployed policy. Latency is recorded but is not the sole or primary decision criterion.",
        "Fugu (Sakana AI, 2026; final research release), Conductor (Nielsen et al., 2026; ICLR 2026 conference paper), TRINITY (Xu et al., 2026; ICLR 2026 conference paper), and the strong-single-agent baseline (Xu et al., 2026; preprint) guide the design, but repository tests and retained measurements determine the deployed policy. Publication status and complete APA 7 references are maintained in [the NVIDIA NIM live-conformance design](docs/superpowers/specs/2026-08-06-ai-nim-live-conformance-design.md). Latency is recorded but is not the sole or primary decision criterion.",
        "AGENTS research attribution",
    )

    plan = "docs/superpowers/plans/2026-08-06-ai-nim-live-conformance.md"
    source = read(plan)
    source = source.replace(
        "- Modify: `apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts`\n",
        "- Modify: `apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts`\n- Create: `apps/ai-service/src/contextual-orchestrator-proposal-contract.test.ts`\n",
        1,
    )
    source = source.replace(
        "pnpm --filter @life-os/ai-service exec vitest run src/contextual-orchestrator-proposal-model.test.ts --no-file-parallelism",
        "pnpm --filter @life-os/ai-service exec vitest run src/contextual-orchestrator-proposal-model.test.ts src/contextual-orchestrator-proposal-contract.test.ts --no-file-parallelism",
        2,
    )
    source = source.replace(
        "git add apps/ai-service/src/contextual-orchestrator-proposal-model.ts apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts",
        "git add apps/ai-service/src/contextual-orchestrator-proposal-model.ts apps/ai-service/src/contextual-orchestrator-proposal-model.test.ts apps/ai-service/src/contextual-orchestrator-proposal-contract.test.ts",
        1,
    )
    write(plan, source)

    spec = "docs/superpowers/specs/2026-08-06-ai-nim-live-conformance-design.md"
    source = read(spec)
    old_research = """Fugu presents one API that dynamically chooses direct solution or a coordinated expert team. Conductor learns natural-language communication topologies and targeted instructions, including recursive self-selection for dynamic test-time scaling. TRINITY assigns Thinker, Worker, and Verifier roles over multiple turns with a lightweight evolved coordinator. These sources support measuring topology, delegation, verification, recursion, and access patterns rather than assuming that more agents are automatically better.

A 2026 strong-single-agent study reports that a multi-turn single agent can match homogeneous multi-agent workflows in several settings, with KV-cache efficiency advantages. LifeOS therefore treats single-agent routing as the mandatory baseline and accepts deeper orchestration only on measured evidence. This repository-specific seven-fixture suite is too small to establish general model superiority, fairness, or production reliability. Live results are dated evidence for one provider inventory, one suite version, and one pair of exact repository commits.
"""
    new_research = """Sakana AI reports that Fugu dynamically selects either a direct solution path or a coordinated expert team (Sakana AI, 2026). Conductor learns natural-language communication topologies and targeted instructions, including recursive self-selection for dynamic test-time scaling (Nielsen et al., 2026). TRINITY assigns Thinker, Worker, and Verifier roles over multiple turns with a lightweight evolved coordinator (Xu et al., 2026a). These are source-reported capabilities; LifeOS independently decides to measure topology, delegation, verification, recursion, and access patterns rather than assume that additional agents are beneficial.

The strong-single-agent study reports that a multi-turn single agent can match homogeneous multi-agent workflows in several evaluated settings and can benefit from KV-cache efficiency (Xu et al., 2026b). LifeOS therefore uses single-agent routing as the mandatory baseline and accepts deeper orchestration only on repository-specific measured evidence. This seven-fixture suite is too small to establish general model superiority, fairness, or production reliability. Live results are dated evidence for one provider inventory, one suite version, and one pair of exact repository commits.
"""
    if source.count(old_research) != 1:
        raise SystemExit("research basis paragraph: expected one match")
    source = source.replace(old_research, new_research, 1)
    source = source.replace(
        "Nielsen, S., Cetin, E., Schwendeman, P., Sun, Q., Xu, J., & Tang, Y. (2025). _Learning to orchestrate agents in natural language with the Conductor_ [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2512.04388",
        "Nielsen, S., Cetin, E., Schwendeman, P., Sun, Q., Xu, J., & Tang, Y. (2026). _Learning to orchestrate agents in natural language with the Conductor_ [Conference paper]. International Conference on Learning Representations. https://openreview.net/pdf?id=4a133f1e2ca67ceaedb45c3a123cc8125c694ff5",
        1,
    )
    source = source.replace(
        "Xu, J., Sun, Q., Schwendeman, P., Nielsen, S., Cetin, E., & Tang, Y. (2025). _TRINITY: An evolved LLM coordinator_ [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2512.04695",
        "Xu, J., Sun, Q., Schwendeman, P., Nielsen, S., Cetin, E., & Tang, Y. (2026a). _TRINITY: An evolved LLM coordinator_ [Conference paper]. International Conference on Learning Representations. https://doi.org/10.48550/arXiv.2512.04695",
        1,
    )
    source = source.replace(
        "Xu, J., Koesdwiady, A., Bei, S., Han, Y., Huang, B., Wang, D., Chen, Y., Wang, Z., Wang, P., Li, P., & Ding, Y. (2026). _Rethinking the value of multi-agent workflow: A strong single agent baseline_ [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2601.12307",
        "Xu, J., Koesdwiady, A., Bei, S., Han, Y., Huang, B., Wang, D., Chen, Y., Wang, Z., Wang, P., Li, P., & Ding, Y. (2026b). _Rethinking the value of multi-agent workflow: A strong single agent baseline_ [Preprint]. arXiv. https://doi.org/10.48550/arXiv.2601.12307",
        1,
    )
    write(spec, source)


def main() -> None:
    """Apply every reviewed correction in a deterministic order."""

    repair_workflow()
    repair_live_model()
    repair_shared_schema()
    repair_conformance()
    repair_command_publication()
    repair_tests()
    repair_docs()


if __name__ == "__main__":
    main()
