import {
  MAINTENANCE_PLAN_SCHEMA,
  MaintenanceContractError,
  validateMaintenanceContract,
} from './contract.mjs';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const CLASS_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;
const RELATIVE_PATH_PATTERN =
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/?$/u;
const CHECK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._:/()\-]{0,127}$/u;
const MAXIMUM_DIAGNOSES = 20;
const MAXIMUM_STEPS = 20;
const MAXIMUM_STEP_TITLE = 200;
const MAXIMUM_EVIDENCE_ITEMS = 20;
const MAXIMUM_EVIDENCE_LENGTH = 240;
const MAXIMUM_EXPECTED_CHECKS = 30;
const PLAN_KINDS = new Set([
  'diagnose',
  'document',
  'inspect',
  'recommend',
  'verify',
]);
const REASON_CODES = new Set([
  'external_decision_required',
  'no_action_required',
  'no_decision_required',
  'orchestrator_unavailable',
  'permission_required',
  'provider_unavailable',
]);
const FORBIDDEN_CONTENT = [
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/iu,
  /\b(?:api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/iu,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\b(?:gh[pousr]|sk)-[A-Za-z0-9_-]{8,}/u,
  /<\/?[A-Za-z][^>]*>/u,
  /(?:chain[- ]of[- ]thought|hidden reasoning|internal reasoning|<think>)/iu,
  /(?:git\s+(?:push|merge|tag)|gh\s+pr\s+(?:create|merge)|workflow_dispatch)/iu,
];

/** Stable credential-free failure for unsafe maintenance-plan output. */
export class MaintenancePlanError extends Error {
  /** Creates one fixed plan validation failure without retaining model text. */
  constructor() {
    super('Maintenance plan output is invalid');
    this.name = 'MaintenancePlanError';
  }
}

/** Raises the stable maintenance-plan validation failure. */
function invalid() {
  throw new MaintenancePlanError();
}

/** Returns one object-shaped value or fails closed. */
function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : invalid();
}

/** Requires one exact object key set. */
function exactKeys(value, expectedKeys) {
  const actual = Object.keys(value);
  const expected = new Set(expectedKeys);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    invalid();
  }
}

/** Requires one bounded credential-free string. */
function safeString(value, maximumLength, pattern) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    (pattern && !pattern.test(value)) ||
    FORBIDDEN_CONTENT.some((forbidden) => forbidden.test(value))
  ) {
    return invalid();
  }
  return value;
}

/** Requires one unique bounded array. */
function uniqueArray(value, maximumLength, parser) {
  if (!Array.isArray(value) || value.length > maximumLength) {
    return invalid();
  }
  const parsed = value.map(parser);
  if (new Set(parsed.map((item) => JSON.stringify(item))).size !== parsed.length) {
    invalid();
  }
  return Object.freeze(parsed);
}

/** Requires one bounded non-negative integer. */
function integer(value, maximum) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    return invalid();
  }
  return value;
}

/** Returns whether one recommended path is permitted by the contract prefix. */
function pathAllowed(path, allowedPrefixes) {
  return allowedPrefixes.some((prefix) => {
    const normalizedPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return path === prefix || path.startsWith(normalizedPrefix);
  });
}

/** Validates one ordered plan step against the contract allowlist. */
function planStep(value, allowedPrefixes, expectedSequence) {
  const step = record(value);
  exactKeys(step, [
    'sequence',
    'title',
    'kind',
    'pathPrefixes',
    'expectedEvidence',
  ]);
  if (integer(step.sequence, MAXIMUM_STEPS) !== expectedSequence) {
    invalid();
  }
  const title = safeString(step.title, MAXIMUM_STEP_TITLE);
  if (!PLAN_KINDS.has(step.kind)) {
    invalid();
  }
  const paths = uniqueArray(step.pathPrefixes, 20, (path) =>
    safeString(path, 256, RELATIVE_PATH_PATTERN),
  );
  if (paths.some((path) => !pathAllowed(path, allowedPrefixes))) {
    invalid();
  }
  const expectedEvidence = uniqueArray(
    step.expectedEvidence,
    MAXIMUM_EVIDENCE_ITEMS,
    (item) => safeString(item, MAXIMUM_EVIDENCE_LENGTH),
  );
  return Object.freeze({
    sequence: step.sequence,
    title,
    kind: step.kind,
    pathPrefixes: paths,
    expectedEvidence,
  });
}

/** Recursively freezes one validated public result. */
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
 * Validates one model-authored plan against the exact deterministic contract.
 * Model output can recommend work but cannot authorize repository mutation.
 */
export function validateMaintenancePlan(contractValue, value) {
  let contract;
  try {
    contract = validateMaintenanceContract(contractValue);
  } catch (error) {
    if (error instanceof MaintenanceContractError) {
      return invalid();
    }
    throw error;
  }
  const plan = record(value);
  exactKeys(plan, [
    'schema',
    'contractDigest',
    'sourceCommitSha',
    'action',
    'computeProfile',
    'diagnosisClasses',
    'steps',
    'expectedChecks',
    'decisionRequired',
    'reasonCode',
    'acknowledgedProhibitions',
  ]);
  if (
    plan.schema !== MAINTENANCE_PLAN_SCHEMA ||
    safeString(plan.contractDigest, 64, SHA_256_PATTERN) !==
      contract.contractDigest ||
    safeString(plan.sourceCommitSha, 40, COMMIT_SHA_PATTERN) !==
      contract.sourceCommitSha ||
    plan.action !== contract.action ||
    plan.computeProfile !== contract.computeProfile ||
    typeof plan.decisionRequired !== 'boolean' ||
    !REASON_CODES.has(plan.reasonCode)
  ) {
    invalid();
  }

  const diagnosisClasses = uniqueArray(
    plan.diagnosisClasses,
    MAXIMUM_DIAGNOSES,
    (item) => safeString(item, 64, CLASS_PATTERN),
  );
  if (!Array.isArray(plan.steps) || plan.steps.length > MAXIMUM_STEPS) {
    invalid();
  }
  const steps = Object.freeze(
    plan.steps.map((step, index) =>
      planStep(step, contract.allowedPathPrefixes, index + 1),
    ),
  );
  if (
    contract.computeProfile === 'none' && steps.length !== 0 ||
    contract.computeProfile !== 'none' && steps.length === 0
  ) {
    invalid();
  }
  const expectedChecks = uniqueArray(
    plan.expectedChecks,
    MAXIMUM_EXPECTED_CHECKS,
    (check) => safeString(check, 128, CHECK_NAME_PATTERN),
  );
  const acknowledgedProhibitions = uniqueArray(
    plan.acknowledgedProhibitions,
    contract.prohibitedOperations.length,
    (item) => safeString(item, 64, CLASS_PATTERN),
  );
  if (
    acknowledgedProhibitions.length !== contract.prohibitedOperations.length ||
    acknowledgedProhibitions.some(
      (item, index) => item !== contract.prohibitedOperations[index],
    )
  ) {
    invalid();
  }
  if (
    plan.decisionRequired &&
    !['external_decision_required', 'permission_required'].includes(
      plan.reasonCode,
    )
  ) {
    invalid();
  }
  if (
    !plan.decisionRequired &&
    ['external_decision_required', 'permission_required'].includes(
      plan.reasonCode,
    )
  ) {
    invalid();
  }
  return deepFreeze({
    schema: plan.schema,
    contractDigest: plan.contractDigest,
    sourceCommitSha: plan.sourceCommitSha,
    action: plan.action,
    computeProfile: plan.computeProfile,
    diagnosisClasses,
    steps,
    expectedChecks,
    decisionRequired: plan.decisionRequired,
    reasonCode: plan.reasonCode,
    acknowledgedProhibitions,
  });
}

/** Renders one validated plan into bounded operator-readable Markdown. */
export function renderMaintenancePlanMarkdown(planValue) {
  const plan = record(planValue);
  const lines = [
    '# LifeOS maintenance plan',
    '',
    `- Source commit: \`${safeString(plan.sourceCommitSha, 40, COMMIT_SHA_PATTERN)}\``,
    `- Action: \`${safeString(plan.action, 32, CLASS_PATTERN)}\``,
    `- Compute profile: \`${safeString(plan.computeProfile, 32, CLASS_PATTERN)}\``,
    `- Decision required: \`${String(Boolean(plan.decisionRequired))}\``,
    `- Reason: \`${safeString(plan.reasonCode, 64, CLASS_PATTERN)}\``,
    '',
    '## Diagnosis classes',
    '',
  ];
  const diagnoses = uniqueArray(
    plan.diagnosisClasses,
    MAXIMUM_DIAGNOSES,
    (item) => safeString(item, 64, CLASS_PATTERN),
  );
  lines.push(...(diagnoses.length ? diagnoses.map((item) => `- \`${item}\``) : ['- None']));
  lines.push('', '## Ordered plan', '');
  if (!Array.isArray(plan.steps)) invalid();
  if (plan.steps.length === 0) {
    lines.push('- No model-authored action is authorized.');
  } else {
    for (const step of plan.steps) {
      const item = record(step);
      lines.push(
        `${integer(item.sequence, MAXIMUM_STEPS)}. **${safeString(item.title, MAXIMUM_STEP_TITLE)}** — \`${safeString(item.kind, 32, CLASS_PATTERN)}\``,
      );
    }
  }
  lines.push('', '## Expected checks', '');
  const checks = uniqueArray(
    plan.expectedChecks,
    MAXIMUM_EXPECTED_CHECKS,
    (check) => safeString(check, 128, CHECK_NAME_PATTERN),
  );
  lines.push(...(checks.length ? checks.map((check) => `- ${check}`) : ['- None']));
  return `${lines.join('\n')}\n`;
}
