import {
  COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA,
  CommercialDevelopmentContractError,
  normalizeCommercialDevelopmentPolicy,
  validateCommercialDevelopmentIssue,
  validateCommercialDevelopmentReceipt,
  validateCommercialDevelopmentRun,
} from './contracts.mjs';

const INPUT_KEYS = Object.freeze([
  'run',
  'policy',
  'issue',
  'status',
  'reasonCode',
  'opencodeVersion',
  'diff',
  'branchName',
  'pullRequestUrl',
  'completedAt',
  'validations',
]);
const DIFF_KEYS = Object.freeze([
  'changed_files',
  'changed_bytes',
  'additions',
  'deletions',
]);

/** Stable composition failure that never retains rejected source or credentials. */
export class CommercialDevelopmentReceiptError extends Error {
  /** Creates one credential-free receipt-composition failure. */
  constructor() {
    super('Commercial development receipt could not be composed');
    this.name = 'CommercialDevelopmentReceiptError';
  }
}

/** Throws the stable composition failure. */
function invalid() {
  throw new CommercialDevelopmentReceiptError();
}

/** Returns whether a value is a non-array record. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires one exact object key set. */
function requireExactKeys(value, expectedKeys) {
  const expected = new Set(expectedKeys);
  const keys = Object.keys(value);
  if (
    keys.length !== expected.size ||
    keys.some((key) => !expected.has(key))
  ) {
    invalid();
  }
}

/** Requires one non-negative safe integer. */
function requireCounter(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000) {
    return invalid();
  }
  return value;
}

/** Normalizes optional deterministic diff counts without retaining file paths. */
function normalizeDiff(value) {
  if (value === null) {
    return {
      changed_files: 0,
      changed_bytes: 0,
      additions: 0,
      deletions: 0,
    };
  }
  if (!isRecord(value)) {
    return invalid();
  }
  requireExactKeys(value, DIFF_KEYS);
  return {
    changed_files: requireCounter(value.changed_files),
    changed_bytes: requireCounter(value.changed_bytes),
    additions: requireCounter(value.additions),
    deletions: requireCounter(value.deletions),
  };
}

/**
 * Composes one validated credential-free receipt from already bounded run,
 * issue, validation, and diff evidence.
 */
export function createCommercialDevelopmentReceipt(value) {
  try {
    if (!isRecord(value)) {
      return invalid();
    }
    requireExactKeys(value, INPUT_KEYS);
    const policy = normalizeCommercialDevelopmentPolicy(value.policy);
    const run = validateCommercialDevelopmentRun(value.run, policy);
    const issue =
      value.issue === null
        ? null
        : validateCommercialDevelopmentIssue(value.issue, policy);
    const diff = normalizeDiff(value.diff);
    return validateCommercialDevelopmentReceipt({
      schema: COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA,
      run_id: run.run_id,
      repository: run.repository,
      base_sha: run.base_sha,
      issue:
        issue === null ? null : { number: issue.number, url: issue.url },
      status: value.status,
      reason_code: value.reasonCode,
      opencode_version: value.opencodeVersion,
      model_label: run.model_label,
      changed_files: diff.changed_files,
      changed_bytes: diff.changed_bytes,
      additions: diff.additions,
      deletions: diff.deletions,
      branch_name: value.branchName,
      pull_request_url: value.pullRequestUrl,
      started_at: run.started_at,
      completed_at: value.completedAt,
      validations: value.validations,
    });
  } catch (error) {
    if (error instanceof CommercialDevelopmentReceiptError) {
      throw error;
    }
    if (error instanceof CommercialDevelopmentContractError) {
      return invalid();
    }
    return invalid();
  }
}

/** Serializes one validated receipt as canonical indented JSON plus newline. */
export function serializeCommercialDevelopmentReceipt(value) {
  try {
    const receipt = validateCommercialDevelopmentReceipt(value);
    return `${JSON.stringify(receipt, null, 2)}\n`;
  } catch (error) {
    if (error instanceof CommercialDevelopmentReceiptError) {
      throw error;
    }
    return invalid();
  }
}
