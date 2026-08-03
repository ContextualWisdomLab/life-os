import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const FINDINGS_SCHEMA = 'appguardrail.findings.v1';
const CONTRACT_SCHEMA = 'life-os.appguardrail-contract.v1';
const INVALID_FINDINGS = 'Invalid AppGuardrail findings envelope';
const INVALID_CONTRACT = 'Invalid AppGuardrail detector contract';
const DUPLICATE_CONTRACT = 'Duplicate AppGuardrail detector contract entry';
const MISSING_DETECTION = 'Expected AppGuardrail detection is missing';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

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

function findingKey(value) {
  return [
    value.issue,
    value.rule_id,
    value.severity,
    value.context,
    value.file,
  ].join('|');
}

function isExactMatch(finding, expected) {
  return (
    finding.rule_id === expected.rule_id &&
    finding.severity === expected.severity &&
    finding.context === expected.context &&
    finding.file === expected.file
  );
}

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

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('Unable to read AppGuardrail contract evidence');
  }
}

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
