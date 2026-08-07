#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  compileMaintenanceContract,
  validateMaintenanceContract,
} from './contract.mjs';
import {
  renderMaintenancePlanMarkdown,
  validateMaintenancePlan,
} from './plan.mjs';

const MAXIMUM_INPUT_BYTES = 1024 * 1024;
const MAXIMUM_ARGUMENTS = 20;
const REVIEW_FINDING_CHECK = 'Unresolved Review Threads';

/** Stable credential-free failure raised by the maintenance CLI boundary. */
export class MaintenanceCliError extends Error {
  /** Creates one stable CLI failure without retaining paths or input text. */
  constructor(code = 'maintenance_cli_failed') {
    super(code);
    this.name = 'MaintenanceCliError';
    this.code = code;
  }
}

/** Raises one stable CLI failure code. */
function fail(code) {
  throw new MaintenanceCliError(code);
}

/** Returns one object-shaped JSON value or fails closed. */
function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : fail('invalid_json_shape');
}

/** Requires one absolute bounded path. */
function absolutePath(value) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 4096 ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    !isAbsolute(value)
  ) {
    return fail('invalid_path');
  }
  return resolve(value);
}

/** Returns the production file-system seam. */
function productionFileSystem() {
  return Object.freeze({ mkdir, readFile, writeFile, rename, unlink });
}

/** Reads and parses one bounded UTF-8 JSON file. */
export async function readBoundedJson(
  path,
  fileSystem = productionFileSystem(),
) {
  let text;
  try {
    text = await fileSystem.readFile(absolutePath(path), { encoding: 'utf8' });
  } catch {
    return fail('input_read_failed');
  }
  if (
    typeof text !== 'string' ||
    text.length === 0 ||
    Buffer.byteLength(text, 'utf8') > MAXIMUM_INPUT_BYTES
  ) {
    return fail('input_size_invalid');
  }
  try {
    return JSON.parse(text);
  } catch {
    return fail('input_json_invalid');
  }
}

/** Removes a temporary file while ignoring absence only. */
async function removeTemporary(fileSystem, path) {
  try {
    await fileSystem.unlink(path);
  } catch (error) {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

/** Atomically writes one bounded text artifact after reading it back. */
export async function publishText(
  finalPath,
  text,
  fileSystem = productionFileSystem(),
  uuidFactory = randomUUID,
) {
  const target = absolutePath(finalPath);
  if (
    typeof text !== 'string' ||
    text.length === 0 ||
    Buffer.byteLength(text, 'utf8') > MAXIMUM_INPUT_BYTES
  ) {
    return fail('output_size_invalid');
  }
  const temporaryPath = `${target}.temporary-${uuidFactory()}`;
  await fileSystem.mkdir(dirname(target), { recursive: true });
  try {
    await fileSystem.writeFile(temporaryPath, text, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    const persisted = await fileSystem.readFile(temporaryPath, {
      encoding: 'utf8',
    });
    if (persisted !== text) {
      return fail('output_readback_mismatch');
    }
    await fileSystem.rename(temporaryPath, target);
  } catch (error) {
    try {
      await removeTemporary(fileSystem, temporaryPath);
    } catch {
      // Cleanup details remain deliberately hidden behind the stable failure.
    }
    if (error instanceof MaintenanceCliError) {
      throw error;
    }
    return fail('output_publish_failed');
  }
}

/** Extracts stable failed-check names from one bounded PR snapshot. */
function failedChecks(pullRequest) {
  const checks = new Set();
  for (const workflow of Array.isArray(pullRequest.workflows)
    ? pullRequest.workflows
    : []) {
    if (
      workflow &&
      typeof workflow.name === 'string' &&
      (workflow.status !== 'completed' || workflow.conclusion !== 'success')
    ) {
      checks.add(workflow.name);
    }
  }
  for (const status of Array.isArray(pullRequest.statuses)
    ? pullRequest.statuses
    : []) {
    if (
      status &&
      typeof status.context === 'string' &&
      status.state !== 'success'
    ) {
      checks.add(status.context);
    }
  }
  for (const blocker of Array.isArray(pullRequest.blockers)
    ? pullRequest.blockers
    : []) {
    if (typeof blocker !== 'string') continue;
    for (const prefix of [
      'workflow-not-successful:',
      'status-not-successful:',
    ]) {
      if (blocker.startsWith(prefix) && blocker.length > prefix.length) {
        checks.add(blocker.slice(prefix.length));
      }
    }
  }
  if (
    Number.isSafeInteger(pullRequest.unresolved_threads) &&
    pullRequest.unresolved_threads > 0
  ) {
    checks.add(REVIEW_FINDING_CHECK);
  }
  return [...checks].sort();
}

/** Converts commercial-readiness evidence into normalized contract input. */
export function normalizeMaintenanceEvidence(
  snapshotValue,
  auditValue,
  fingerprintValue,
) {
  const snapshot = record(snapshotValue);
  const audit = record(auditValue);
  const fingerprint = record(fingerprintValue);
  if (
    snapshot.schema !== 'life-os.github-snapshot.v1' ||
    audit.schema !== 'life-os.commercial-readiness-report.v1' ||
    snapshot.repository !== audit.repository && audit.repository !== undefined ||
    snapshot.commit_sha !== audit.commit_sha ||
    snapshot.generated_at !== audit.generated_at ||
    snapshot.truncated === true
  ) {
    return fail('repository_evidence_mismatch');
  }
  const pullRequests = (Array.isArray(snapshot.pull_requests)
    ? snapshot.pull_requests
    : fail('pull_request_evidence_invalid')
  ).map((item) => {
    const pull = record(item);
    return {
      number: pull.number,
      headSha: pull.head_sha,
      draft: pull.draft === true,
      failedChecks: failedChecks(pull),
      unresolvedFindings: [],
      changedPaths: [],
    };
  });
  const capabilities = new Map(
    (Array.isArray(audit.capabilities)
      ? audit.capabilities
      : fail('capability_evidence_invalid')
    ).map((item) => [item.id, item]),
  );
  const buyerGaps = (Array.isArray(audit.gaps)
    ? audit.gaps
    : fail('gap_evidence_invalid')
  ).map((item) => {
    const gap = record(item);
    const capability = record(capabilities.get(gap.capability_id));
    const evidencePaths = (Array.isArray(gap.missing_evidence)
      ? gap.missing_evidence
      : []
    ).filter((path) => typeof path === 'string');
    const fallbackPaths = (Array.isArray(capability.evidence)
      ? capability.evidence
      : []
    )
      .map((entry) => entry?.path)
      .filter((path) => typeof path === 'string');
    return {
      capabilityId: gap.capability_id,
      customerImpact: capability.customer_impact,
      risk: capability.risk,
      acquisitionImpact: capability.acquisition_impact,
      effort: capability.effort,
      allowedPathPrefixes: [...new Set(
        evidencePaths.length > 0 ? evidencePaths : fallbackPaths,
      )].sort(),
    };
  });
  return {
    repository: snapshot.repository,
    commitSha: snapshot.commit_sha,
    generatedAt: snapshot.generated_at,
    pullRequests,
    buyerGaps,
    reviewAgentFingerprint: fingerprint,
  };
}

/** Parses one exact flag/value command line. */
function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length < 1 || argv.length > MAXIMUM_ARGUMENTS) {
    return fail('arguments_invalid');
  }
  const [command, ...rest] = argv;
  if (rest.length % 2 !== 0) {
    return fail('arguments_invalid');
  }
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (
      typeof flag !== 'string' ||
      !/^--[a-z][a-z-]*$/u.test(flag) ||
      values.has(flag) ||
      typeof value !== 'string'
    ) {
      return fail('arguments_invalid');
    }
    values.set(flag, value);
  }
  return { command, values };
}

/** Requires exactly the named flags and returns absolute paths. */
function requiredPaths(values, names) {
  if (
    values.size !== names.length ||
    names.some((name) => !values.has(name))
  ) {
    return fail('arguments_invalid');
  }
  return Object.fromEntries(
    names.map((name) => [name.slice(2), absolutePath(values.get(name))]),
  );
}

/** Runs one maintenance CLI command with injectable deterministic seams. */
export async function runMaintenanceCli(
  argv,
  dependencies = {},
) {
  const { command, values } = parseArguments(argv);
  const fileSystem = dependencies.fileSystem ?? productionFileSystem();
  const uuidFactory = dependencies.uuidFactory ?? randomUUID;
  if (command === 'compile') {
    const paths = requiredPaths(values, [
      '--snapshot',
      '--audit',
      '--fingerprint',
      '--output',
    ]);
    const [snapshot, audit, fingerprint] = await Promise.all([
      readBoundedJson(paths.snapshot, fileSystem),
      readBoundedJson(paths.audit, fileSystem),
      readBoundedJson(paths.fingerprint, fileSystem),
    ]);
    const contract = compileMaintenanceContract(
      normalizeMaintenanceEvidence(snapshot, audit, fingerprint),
    );
    await publishText(
      paths.output,
      `${JSON.stringify(contract, null, 2)}\n`,
      fileSystem,
      uuidFactory,
    );
    return contract;
  }
  if (command === 'validate-plan') {
    const paths = requiredPaths(values, [
      '--contract',
      '--plan',
      '--validated',
      '--markdown',
    ]);
    const [contractValue, planValue] = await Promise.all([
      readBoundedJson(paths.contract, fileSystem),
      readBoundedJson(paths.plan, fileSystem),
    ]);
    const contract = validateMaintenanceContract(contractValue);
    const plan = validateMaintenancePlan(contract, planValue);
    await publishText(
      paths.validated,
      `${JSON.stringify(plan, null, 2)}\n`,
      fileSystem,
      uuidFactory,
    );
    await publishText(
      paths.markdown,
      renderMaintenancePlanMarkdown(plan),
      fileSystem,
      uuidFactory,
    );
    return plan;
  }
  return fail('command_invalid');
}

/** Process entry point that emits only one stable failure code. */
export async function main(argv = process.argv.slice(2)) {
  try {
    await runMaintenanceCli(argv);
  } catch (error) {
    const code =
      error instanceof MaintenanceCliError
        ? error.code
        : 'maintenance_cli_failed';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(fileURLToPath(pathToFileURL(resolve(process.argv[1])))).href
  : '';
if (invokedPath === import.meta.url) {
  await main();
}
