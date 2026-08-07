import { createHash } from 'node:crypto';

/** Versioned schema identifier for reviewed maintenance-agent input. */
export const MAINTENANCE_CONTRACT_SCHEMA =
  'life-os.maintenance-contract.v1';

/** Versioned schema identifier expected from the plan-only OpenCode agent. */
export const MAINTENANCE_PLAN_SCHEMA = 'life-os.maintenance-plan.v1';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const REPOSITORY_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})\/[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/u;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/u;
const CHECK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:/()\-]{0,127}$/u;
const FINDING_CLASS_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;
const RELATIVE_PATH_PATTERN =
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/?$/u;
const MAXIMUM_PULL_REQUESTS = 50;
const MAXIMUM_BUYER_GAPS = 100;
const MAXIMUM_CHECKS = 30;
const MAXIMUM_FINDINGS = 50;
const MAXIMUM_PATHS = 100;
const HIGH_RISK_FINDING_CLASSES = new Set([
  'credential_exposure',
  'destructive_operation',
  'migration_safety',
  'security',
  'tenant_boundary',
  'workflow_permissions',
]);
const PROHIBITED_OPERATIONS = Object.freeze([
  'approve_pull_request',
  'change_branch_protection',
  'change_review_agent_credentials',
  'commit_source',
  'create_or_merge_pull_request',
  'merge_pull_request',
  'publish_release',
  'read_or_emit_credentials',
  'tag_release',
]);
const PROFILE_LIMITS = Object.freeze({
  none: Object.freeze({
    maxAgentSteps: 0,
    maxDecompositionDepth: 0,
    maxRecursionDepth: 0,
    maxRoleCount: 0,
    maxOutputBytes: 0,
  }),
  route_standard: Object.freeze({
    maxAgentSteps: 12,
    maxDecompositionDepth: 1,
    maxRecursionDepth: 0,
    maxRoleCount: 1,
    maxOutputBytes: 32_768,
  }),
  route_high: Object.freeze({
    maxAgentSteps: 20,
    maxDecompositionDepth: 2,
    maxRecursionDepth: 1,
    maxRoleCount: 2,
    maxOutputBytes: 49_152,
  }),
  conduct_bounded: Object.freeze({
    maxAgentSteps: 32,
    maxDecompositionDepth: 3,
    maxRecursionDepth: 2,
    maxRoleCount: 4,
    maxOutputBytes: 65_536,
  }),
});

/** Stable credential-free failure raised for malformed maintenance evidence. */
export class MaintenanceContractError extends Error {
  /** Creates one fixed failure without retaining rejected values. */
  constructor() {
    super('Maintenance contract evidence is invalid');
    this.name = 'MaintenanceContractError';
  }
}

/** Raises the stable maintenance-contract validation failure. */
function invalid() {
  throw new MaintenanceContractError();
}

/** Returns one object-shaped value or fails closed. */
function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : invalid();
}

/** Requires one exact object key set. */
function exactKeys(value, expectedKeys) {
  const keys = Object.keys(value);
  const expected = new Set(expectedKeys);
  if (
    keys.length !== expected.size ||
    keys.some((key) => !expected.has(key))
  ) {
    invalid();
  }
}

/** Requires one bounded string matching an optional allowlist pattern. */
function boundedString(value, maximumLength, pattern) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    (pattern && !pattern.test(value))
  ) {
    return invalid();
  }
  return value;
}

/** Requires one canonical lowercase commit SHA. */
function commitSha(value) {
  return boundedString(value, 40, COMMIT_SHA_PATTERN);
}

/** Requires one canonical SHA-256 hexadecimal digest. */
function sha256(value) {
  return boundedString(value, 64, SHA_256_PATTERN);
}

/** Requires one canonical UTC timestamp. */
function timestamp(value) {
  const candidate = boundedString(value, 64);
  let canonical;
  try {
    canonical = new Date(candidate).toISOString();
  } catch {
    return invalid();
  }
  return canonical === candidate ? candidate : invalid();
}

/** Requires one bounded non-negative safe integer. */
function integer(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    return invalid();
  }
  return value;
}

/** Requires one positive GitHub issue or pull-request number. */
function externalNumber(value) {
  const parsed = integer(value, 2_147_483_647);
  return parsed > 0 ? parsed : invalid();
}

/** Requires one unique bounded array. */
function uniqueArray(value, maximumLength, parser) {
  if (!Array.isArray(value) || value.length > maximumLength) {
    return invalid();
  }
  const parsed = value.map(parser);
  if (new Set(parsed.map((item) => JSON.stringify(item))).size !== parsed.length) {
    return invalid();
  }
  return Object.freeze(parsed);
}

/** Requires one relative in-repository path or directory prefix. */
function relativePath(value) {
  return boundedString(value, 256, RELATIVE_PATH_PATTERN);
}

/** Validates one normalized actionable review finding. */
function finding(value) {
  const item = record(value);
  exactKeys(item, ['category', 'severity', 'path']);
  const category = boundedString(item.category, 64, FINDING_CLASS_PATTERN);
  if (!['critical', 'high', 'medium', 'low', 'info'].includes(item.severity)) {
    invalid();
  }
  return Object.freeze({
    category,
    severity: item.severity,
    path: relativePath(item.path),
  });
}

/** Validates one normalized pull-request evidence cell. */
function pullRequest(value) {
  const item = record(value);
  exactKeys(item, [
    'number',
    'headSha',
    'draft',
    'failedChecks',
    'unresolvedFindings',
    'changedPaths',
  ]);
  if (typeof item.draft !== 'boolean') {
    invalid();
  }
  return Object.freeze({
    number: externalNumber(item.number),
    headSha: commitSha(item.headSha),
    draft: item.draft,
    failedChecks: uniqueArray(item.failedChecks, MAXIMUM_CHECKS, (check) =>
      boundedString(check, 128, CHECK_NAME_PATTERN),
    ),
    unresolvedFindings: uniqueArray(
      item.unresolvedFindings,
      MAXIMUM_FINDINGS,
      finding,
    ),
    changedPaths: uniqueArray(item.changedPaths, MAXIMUM_PATHS, relativePath),
  });
}

/** Validates one evidence-backed buyer gap. */
function buyerGap(value) {
  const item = record(value);
  exactKeys(item, [
    'capabilityId',
    'customerImpact',
    'risk',
    'acquisitionImpact',
    'effort',
    'allowedPathPrefixes',
  ]);
  return Object.freeze({
    capabilityId: boundedString(item.capabilityId, 128, CAPABILITY_PATTERN),
    customerImpact: integer(item.customerImpact, 5),
    risk: integer(item.risk, 5),
    acquisitionImpact: integer(item.acquisitionImpact, 5),
    effort: integer(item.effort, 5),
    allowedPathPrefixes: uniqueArray(
      item.allowedPathPrefixes,
      MAXIMUM_PATHS,
      relativePath,
    ),
  });
}

/** Validates the immutable fingerprint of independent review-agent configuration. */
function reviewAgentFingerprint(value) {
  const item = record(value);
  exactKeys(item, ['workflowPaths', 'secretNames', 'digest']);
  return Object.freeze({
    workflowPaths: uniqueArray(item.workflowPaths, 50, relativePath),
    secretNames: uniqueArray(item.secretNames, 50, (name) =>
      boundedString(name, 128, /^[A-Z][A-Z0-9_]{2,127}$/u),
    ),
    digest: sha256(item.digest),
  });
}

/** Recursively canonicalizes JSON objects by sorted key order. */
function canonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

/** Serializes one JSON-compatible value with deterministic object-key ordering. */
export function canonicalMaintenanceJson(value) {
  return JSON.stringify(canonicalValue(value));
}

/** Computes a canonical digest while excluding the self-referential digest field. */
export function maintenanceContractDigest(value) {
  const item = record(value);
  const { contractDigest: _ignored, ...unsigned } = item;
  return createHash('sha256')
    .update(canonicalMaintenanceJson(unsigned), 'utf8')
    .digest('hex');
}

/** Returns one deterministic buyer-value score used only for ordering gaps. */
function gapScore(gap) {
  return (
    gap.customerImpact * 2 +
    gap.risk * 2 +
    gap.acquisitionImpact -
    gap.effort
  );
}

/** Selects the one PR requiring attention, preferring actionable evidence. */
function selectPullRequest(pullRequests) {
  return [...pullRequests].sort((left, right) => {
    const leftActionable =
      left.failedChecks.length + left.unresolvedFindings.length > 0 ? 0 : 1;
    const rightActionable =
      right.failedChecks.length + right.unresolvedFindings.length > 0 ? 0 : 1;
    return leftActionable - rightActionable || left.number - right.number;
  })[0];
}

/** Selects the highest-value buyer gap with deterministic tie-breaking. */
function selectGap(gaps) {
  return [...gaps].sort(
    (left, right) =>
      gapScore(right) - gapScore(left) ||
      left.capabilityId.localeCompare(right.capabilityId),
  )[0];
}

/** Chooses the bounded compute profile from deterministic risk evidence. */
function computeProfile(action, selectedPr, selectedGap) {
  if (action === 'wait' || action === 'complete') {
    return 'none';
  }
  if (
    selectedPr?.unresolvedFindings.some(
      (item) =>
        item.severity === 'critical' ||
        item.severity === 'high' ||
        HIGH_RISK_FINDING_CLASSES.has(item.category),
    ) ||
    (selectedGap && selectedGap.risk === 5)
  ) {
    return 'conduct_bounded';
  }
  if (
    (selectedPr &&
      (selectedPr.failedChecks.length > 1 ||
        selectedPr.unresolvedFindings.length > 1 ||
        selectedPr.changedPaths.length > 4)) ||
    (selectedGap && selectedGap.effort >= 4)
  ) {
    return 'route_high';
  }
  return 'route_standard';
}

/** Freezes an object recursively enough for the immutable public contract. */
function deepFreeze(value) {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

/**
 * Compiles one plan-only maintenance contract from normalized repository facts.
 * Issue and review prose are deliberately absent from the accepted input shape.
 */
export function compileMaintenanceContract(input) {
  const source = record(input);
  exactKeys(source, [
    'repository',
    'commitSha',
    'generatedAt',
    'pullRequests',
    'buyerGaps',
    'reviewAgentFingerprint',
  ]);
  const repository = boundedString(source.repository, 201, REPOSITORY_PATTERN);
  const sourceCommitSha = commitSha(source.commitSha);
  const generatedAt = timestamp(source.generatedAt);
  const pullRequests = uniqueArray(
    source.pullRequests,
    MAXIMUM_PULL_REQUESTS,
    pullRequest,
  );
  const buyerGaps = uniqueArray(source.buyerGaps, MAXIMUM_BUYER_GAPS, buyerGap);
  const fingerprint = reviewAgentFingerprint(source.reviewAgentFingerprint);
  const selectedPr = selectPullRequest(pullRequests);
  const selectedGap = selectedPr ? undefined : selectGap(buyerGaps);

  let action;
  let reasonCode;
  let target = null;
  let failedChecks = Object.freeze([]);
  let findingClasses = Object.freeze([]);
  let allowedPathPrefixes = Object.freeze([]);

  if (selectedPr) {
    const actionable =
      selectedPr.failedChecks.length + selectedPr.unresolvedFindings.length > 0;
    action = actionable ? 'inspect_pr' : 'wait';
    reasonCode = actionable
      ? 'open_pull_request_requires_attention'
      : 'open_pull_request_in_review';
    target = Object.freeze({
      kind: 'pull_request',
      externalNumber: selectedPr.number,
      headSha: selectedPr.headSha,
    });
    failedChecks = selectedPr.failedChecks;
    findingClasses = Object.freeze(
      [...new Set(selectedPr.unresolvedFindings.map((item) => item.category))].sort(),
    );
    allowedPathPrefixes = Object.freeze([...selectedPr.changedPaths].sort());
  } else if (selectedGap) {
    action = 'recommend_gap';
    reasonCode = 'buyer_gap_available';
    target = Object.freeze({
      kind: 'capability',
      capabilityId: selectedGap.capabilityId,
    });
    allowedPathPrefixes = Object.freeze(
      [...selectedGap.allowedPathPrefixes].sort(),
    );
  } else {
    action = 'complete';
    reasonCode = 'no_buyer_gap_available';
  }

  const profile = computeProfile(action, selectedPr, selectedGap);
  const unsigned = {
    schema: MAINTENANCE_CONTRACT_SCHEMA,
    repository,
    sourceCommitSha,
    generatedAt,
    action,
    reasonCode,
    target,
    computeProfile: profile,
    limits: PROFILE_LIMITS[profile],
    failedChecks,
    findingClasses,
    allowedPathPrefixes,
    prohibitedOperations: PROHIBITED_OPERATIONS,
    reviewAgentFingerprintDigest: fingerprint.digest,
    expectedOutput: Object.freeze({
      path: '.maintenance-output/maintenance-plan.json',
      schema: MAINTENANCE_PLAN_SCHEMA,
    }),
  };
  return validateMaintenanceContract({
    ...unsigned,
    contractDigest: maintenanceContractDigest(unsigned),
  });
}

/** Validates one compiled contract before model execution or artifact reuse. */
export function validateMaintenanceContract(value) {
  const item = record(value);
  exactKeys(item, [
    'schema',
    'repository',
    'sourceCommitSha',
    'generatedAt',
    'action',
    'reasonCode',
    'target',
    'computeProfile',
    'limits',
    'failedChecks',
    'findingClasses',
    'allowedPathPrefixes',
    'prohibitedOperations',
    'reviewAgentFingerprintDigest',
    'expectedOutput',
    'contractDigest',
  ]);
  if (item.schema !== MAINTENANCE_CONTRACT_SCHEMA) invalid();
  boundedString(item.repository, 201, REPOSITORY_PATTERN);
  commitSha(item.sourceCommitSha);
  timestamp(item.generatedAt);
  if (!['inspect_pr', 'recommend_gap', 'wait', 'complete'].includes(item.action)) {
    invalid();
  }
  if (
    ![
      'open_pull_request_requires_attention',
      'open_pull_request_in_review',
      'buyer_gap_available',
      'no_buyer_gap_available',
    ].includes(item.reasonCode)
  ) {
    invalid();
  }
  if (!Object.hasOwn(PROFILE_LIMITS, item.computeProfile)) invalid();
  const expectedLimits = PROFILE_LIMITS[item.computeProfile];
  const limits = record(item.limits);
  exactKeys(limits, Object.keys(expectedLimits));
  for (const [key, expected] of Object.entries(expectedLimits)) {
    if (limits[key] !== expected) invalid();
  }
  uniqueArray(item.failedChecks, MAXIMUM_CHECKS, (check) =>
    boundedString(check, 128, CHECK_NAME_PATTERN),
  );
  uniqueArray(item.findingClasses, MAXIMUM_FINDINGS, (category) =>
    boundedString(category, 64, FINDING_CLASS_PATTERN),
  );
  uniqueArray(item.allowedPathPrefixes, MAXIMUM_PATHS, relativePath);
  const prohibited = uniqueArray(
    item.prohibitedOperations,
    PROHIBITED_OPERATIONS.length,
    (operation) => boundedString(operation, 64, FINDING_CLASS_PATTERN),
  );
  if (
    prohibited.length !== PROHIBITED_OPERATIONS.length ||
    prohibited.some((operation, index) => operation !== PROHIBITED_OPERATIONS[index])
  ) {
    invalid();
  }
  sha256(item.reviewAgentFingerprintDigest);
  const output = record(item.expectedOutput);
  exactKeys(output, ['path', 'schema']);
  if (
    output.path !== '.maintenance-output/maintenance-plan.json' ||
    output.schema !== MAINTENANCE_PLAN_SCHEMA
  ) {
    invalid();
  }
  if (item.target === null) {
    if (item.action !== 'complete') invalid();
  } else {
    const target = record(item.target);
    if (target.kind === 'pull_request') {
      exactKeys(target, ['kind', 'externalNumber', 'headSha']);
      externalNumber(target.externalNumber);
      commitSha(target.headSha);
      if (item.action !== 'inspect_pr' && item.action !== 'wait') invalid();
    } else if (target.kind === 'capability') {
      exactKeys(target, ['kind', 'capabilityId']);
      boundedString(target.capabilityId, 128, CAPABILITY_PATTERN);
      if (item.action !== 'recommend_gap') invalid();
    } else {
      invalid();
    }
  }
  const digest = sha256(item.contractDigest);
  if (digest !== maintenanceContractDigest(item)) invalid();
  return deepFreeze(item);
}
