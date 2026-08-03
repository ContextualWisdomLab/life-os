import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const FINDINGS_SCHEMA = 'appguardrail.findings.v1';
const CONTRACT_SCHEMA = 'life-os.appguardrail-contract.v1';
const INVALID_FINDINGS = 'Invalid AppGuardrail findings envelope';
const INVALID_CONTRACT = 'Invalid AppGuardrail detector contract';
const DUPLICATE_CONTRACT = 'Duplicate AppGuardrail detector contract entry';
const MISSING_DETECTION = 'Expected AppGuardrail detection is missing';

/**
 * Returns whether a value is a plain record suitable for schema validation.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Normalizes a required non-empty string or throws the supplied safe error.
 */
function requireString(value, errorMessage) {
  if (typeof value !== 'string') {
    throw new Error(errorMessage);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorMessage);
  }
  return normalized;
}

/**
 * Validates and minimizes one AppGuardrail finding used by the contract check.
 */
function validateFinding(value) {
  if (!isPlainObject(value)) {
    throw new Error(INVALID_FINDINGS);
  }
  return {
    rule_id: requireString(value.rule_id, INVALID_FINDINGS),
    severity: requireString(value.severity, INVALID_FINDINGS),
    context: requireString(value.context, INVALID_FINDINGS),
    file: requireString(value.file, INVALID_FINDINGS),
  };
}

/**
 * Validates and minimizes one expected detector-contract finding.
 */
function validateExpectedFinding(value) {
  if (!isPlainObject(value)) {
    throw new Error(INVALID_CONTRACT);
  }
  if (!Number.isSafeInteger(value.issue) || value.issue <= 0) {
    throw new Error(INVALID_CONTRACT);
  }
  return {
    issue: value.issue,
    rule_id: requireString(value.rule_id, INVALID_CONTRACT),
    severity: requireString(value.severity, INVALID_CONTRACT),
    context: requireString(value.context, INVALID_CONTRACT),
    file: requireString(value.file, INVALID_CONTRACT),
  };
}

/**
 * Builds a deterministic key for duplicate detector-contract detection.
 */
function findingKey(value) {
  return [
    value.issue,
    value.rule_id,
    value.severity,
    value.context,
    value.file,
  ].join('|');
}

/**
 * Returns whether a scanner finding exactly satisfies an expected finding.
 */
function isExactMatch(finding, expected) {
  return (
    finding.rule_id === expected.rule_id &&
    finding.severity === expected.severity &&
    finding.context === expected.context &&
    finding.file === expected.file
  );
}

/**
 * Verifies that every expected detector-contract entry has an exact finding.
 */
export function verifyAppGuardrailContract(findingsEnvelope, detectorContract) {
  if (
    !isPlainObject(findingsEnvelope) ||
    findingsEnvelope.schema !== FINDINGS_SCHEMA ||
    !Array.isArray(findingsEnvelope.findings)
  ) {
    throw new Error(INVALID_FINDINGS);
  }

  if (
    !isPlainObject(detectorContract) ||
    detectorContract.schema !== CONTRACT_SCHEMA ||
    !Array.isArray(detectorContract.expected_findings)
  ) {
    throw new Error(INVALID_CONTRACT);
  }

  const findings = findingsEnvelope.findings.map(validateFinding);
  const expectedFindings = detectorContract.expected_findings.map(
    validateExpectedFinding,
  );
  const contractKeys = new Set();

  for (const expected of expectedFindings) {
    const key = findingKey(expected);
    if (contractKeys.has(key)) {
      throw new Error(DUPLICATE_CONTRACT);
    }
    contractKeys.add(key);

    if (!findings.some((finding) => isExactMatch(finding, expected))) {
      throw new Error(MISSING_DETECTION);
    }
  }
}

/**
 * Reads and parses a JSON evidence file without disclosing its contents on failure.
 */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Unable to read AppGuardrail contract evidence');
  }
}

/**
 * Runs the command-line detector-contract verifier.
 */
async function runCli() {
  const [, , findingsPath, contractPath, ...unexpectedArguments] = process.argv;
  if (!findingsPath || !contractPath || unexpectedArguments.length > 0) {
    throw new Error(
      'Usage: verify-contract.mjs <findings-json> <contract-json>',
    );
  }

  const [findingsEnvelope, detectorContract] = await Promise.all([
    readJson(findingsPath),
    readJson(contractPath),
  ]);
  verifyAppGuardrailContract(findingsEnvelope, detectorContract);
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  runCli().catch((error) => {
    const message =
      error instanceof Error
        ? error.message
        : 'AppGuardrail contract verification failed';
    console.error(message);
    process.exitCode = 1;
  });
}
