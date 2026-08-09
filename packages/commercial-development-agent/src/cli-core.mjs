import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { validateCommercialDevelopmentDiff } from './diff-validator.mjs';
import { selectCommercialDevelopmentIssue } from './issue-selector.mjs';
import { buildCommercialDevelopmentPrompt } from './prompt-builder.mjs';
import { createCommercialDevelopmentReceipt } from './receipt.mjs';

const MAXIMUM_JSON_BYTES = 1_048_576;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const COMMAND_OPTIONS = Object.freeze({
  select: Object.freeze(['policy', 'issues', 'pulls', 'output']),
  prompt: Object.freeze(['policy', 'run', 'issue', 'output']),
  'validate-diff': Object.freeze(['policy', 'evidence', 'output']),
  receipt: Object.freeze(['input', 'output']),
});

/** Narrow asynchronous file-system seam for deterministic CLI tests. */
export const PRODUCTION_COMMERCIAL_DEVELOPMENT_FILE_SYSTEM = Object.freeze({
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
});

/** Stable CLI failure that never retains file content, prompts, or credentials. */
export class CommercialDevelopmentCliError extends Error {
  /** Creates one credential-free CLI boundary failure. */
  constructor() {
    super('Commercial development command failed');
    this.name = 'CommercialDevelopmentCliError';
  }
}

/** Throws the stable CLI failure. */
function invalid() {
  throw new CommercialDevelopmentCliError();
}

/** Requires one absolute bounded control-free file path. */
function requireAbsolutePath(value) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 4_096 ||
    CONTROL_CHARACTER_PATTERN.test(value) ||
    !isAbsolute(value)
  ) {
    return invalid();
  }
  return value;
}

/** Parses one command and its exact `--name value` argument set. */
function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.length === 0) {
    return invalid();
  }
  const [command, ...rest] = argv;
  if (typeof command !== 'string' || !(command in COMMAND_OPTIONS)) {
    return invalid();
  }
  if (rest.length % 2 !== 0) {
    return invalid();
  }
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (
      typeof flag !== 'string' ||
      !flag.startsWith('--') ||
      typeof value !== 'string'
    ) {
      return invalid();
    }
    const name = flag.slice(2);
    if (
      !COMMAND_OPTIONS[command].includes(name) ||
      Object.hasOwn(options, name)
    ) {
      return invalid();
    }
    options[name] = requireAbsolutePath(value);
  }
  if (
    Object.keys(options).length !== COMMAND_OPTIONS[command].length ||
    COMMAND_OPTIONS[command].some((name) => !Object.hasOwn(options, name))
  ) {
    return invalid();
  }
  return Object.freeze({ command, options: Object.freeze(options) });
}

/** Reads one bounded regular JSON file without retaining parse details. */
async function readBoundedJson(path, fileSystem) {
  const metadata = await fileSystem.stat(path);
  if (
    !metadata.isFile() ||
    metadata.size < 1 ||
    metadata.size > MAXIMUM_JSON_BYTES
  ) {
    return invalid();
  }
  const content = await fileSystem.readFile(path, { encoding: 'utf8' });
  if (
    content.length === 0 ||
    Buffer.byteLength(content, 'utf8') > MAXIMUM_JSON_BYTES ||
    content.includes('\u0000')
  ) {
    return invalid();
  }
  try {
    return JSON.parse(content);
  } catch {
    return invalid();
  }
}

/** Removes one temporary file while ignoring an absent path only. */
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

/** Atomically publishes one private JSON value after reading it back. */
async function writeAtomicJson(path, value, fileSystem, uuidFactory) {
  const token = uuidFactory();
  if (typeof token !== 'string' || !UUID_V4_PATTERN.test(token)) {
    return invalid();
  }
  const temporaryPath = `${path}.temporary-${token}`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  await fileSystem.mkdir(dirname(path), { recursive: true });
  try {
    await fileSystem.writeFile(temporaryPath, payload, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    });
    const persisted = await readBoundedJson(temporaryPath, fileSystem);
    if (JSON.stringify(persisted) !== JSON.stringify(value)) {
      return invalid();
    }
    await fileSystem.rename(temporaryPath, path);
  } catch (error) {
    try {
      await removeTemporary(fileSystem, temporaryPath);
    } catch {
      // Cleanup is best-effort; the public failure remains credential-free.
    }
    if (error instanceof CommercialDevelopmentCliError) {
      throw error;
    }
    return invalid();
  }
}

/** Executes one parsed CLI command through pure bounded domain functions. */
async function executeCommand(command, options, fileSystem) {
  if (command === 'select') {
    const selected = selectCommercialDevelopmentIssue({
      policy: await readBoundedJson(options.policy, fileSystem),
      issues: await readBoundedJson(options.issues, fileSystem),
      openPullRequests: await readBoundedJson(options.pulls, fileSystem),
    });
    return selected;
  }
  if (command === 'prompt') {
    return buildCommercialDevelopmentPrompt({
      policy: await readBoundedJson(options.policy, fileSystem),
      run: await readBoundedJson(options.run, fileSystem),
      issue: await readBoundedJson(options.issue, fileSystem),
    });
  }
  if (command === 'validate-diff') {
    return validateCommercialDevelopmentDiff(
      await readBoundedJson(options.evidence, fileSystem),
      await readBoundedJson(options.policy, fileSystem),
    );
  }
  return createCommercialDevelopmentReceipt(
    await readBoundedJson(options.input, fileSystem),
  );
}

/**
 * Runs one deterministic command and atomically writes its JSON result. The
 * function never invokes a model, GitHub API, shell, or remote mutation.
 */
export async function runCommercialDevelopmentCli(argv, dependencies = {}) {
  try {
    const parsed = parseArguments(argv);
    const fileSystem =
      dependencies.fileSystem ?? PRODUCTION_COMMERCIAL_DEVELOPMENT_FILE_SYSTEM;
    const uuidFactory = dependencies.uuidFactory ?? randomUUID;
    const result = await executeCommand(
      parsed.command,
      parsed.options,
      fileSystem,
    );
    await writeAtomicJson(
      parsed.options.output,
      result ?? null,
      fileSystem,
      uuidFactory,
    );
    return result;
  } catch (error) {
    if (error instanceof CommercialDevelopmentCliError) {
      throw error;
    }
    return invalid();
  }
}
