import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Exact reviewed OpenCode package version pin. */
export const REVIEWED_OPENCODE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+$/u;

/** Rejects the tiny postinstall stub that is not the reviewed CLI binary. */
export const MINIMUM_REVIEWED_OPENCODE_BINARY_BYTES = 1_024;

/** Stable failure when the reviewed OpenCode CLI identity cannot be proven. */
export class OpenCodeIdentityError extends Error {
  /** Creates one credential-free OpenCode identity failure. */
  constructor() {
    super('Installed OpenCode version does not match the reviewed package pin.');
    this.name = 'OpenCodeIdentityError';
  }
}

/** Throws the stable identity failure. */
function invalid() {
  throw new OpenCodeIdentityError();
}

/** Reads the exact `opencode-ai` pin from the commercial-agent package manifest. */
export function readPinnedOpenCodePackageVersion(packageJsonPath) {
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  } catch {
    return invalid();
  }
  const version = packageJson?.devDependencies?.['opencode-ai'];
  if (
    typeof version !== 'string' ||
    !REVIEWED_OPENCODE_VERSION_PATTERN.test(version)
  ) {
    return invalid();
  }
  return version;
}

/** Returns the first newline-terminated identity line without carriage returns. */
export function readOpenCodeVersionLine(stdout) {
  if (typeof stdout !== 'string') {
    return '';
  }
  return stdout.replace(/\r/gu, '').split('\n', 1)[0].trim();
}

/**
 * Builds the isolated environment used to ask the reviewed CLI for its identity.
 * `NODE_OPTIONS` is omitted because OpenCode 1.18.9 uses yargs `hideBin`, which
 * drops `--version` when `process.execArgv` is non-empty.
 */
export function createIsolatedOpenCodeEnvironment(baseEnv = {}) {
  return Object.freeze({
    PATH: baseEnv.PATH || '/usr/bin:/bin',
    HOME: baseEnv.HOME || '/tmp',
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
  });
}

/** Resolves the postinstall-copied binary or the reviewed linux-x64 package binary. */
export function resolveReviewedOpenCodeExecutable(
  opencodePackageDirectory,
  fileSystem = { existsSync, realpathSync, statSync },
) {
  let realPackage;
  try {
    realPackage = fileSystem.realpathSync(opencodePackageDirectory);
  } catch {
    return invalid();
  }

  const candidates = [
    resolve(realPackage, 'bin/opencode.exe'),
    resolve(dirname(realPackage), 'opencode-linux-x64/bin/opencode'),
  ];
  for (const candidate of candidates) {
    if (!fileSystem.existsSync(candidate)) {
      continue;
    }
    let metadata;
    try {
      metadata = fileSystem.statSync(candidate);
    } catch {
      continue;
    }
    if (
      metadata.isFile() &&
      metadata.size >= MINIMUM_REVIEWED_OPENCODE_BINARY_BYTES
    ) {
      return candidate;
    }
  }
  return invalid();
}

/** Spawns one reviewed CLI inquiry with an isolated environment. */
function inquire(spawn, executable, argv, env) {
  try {
    return spawn(executable, argv, {
      encoding: 'utf8',
      env,
      timeout: 30_000,
    });
  } catch {
    return invalid();
  }
}

/**
 * Proves the installed CLI is the reviewed pin, still exposes `--pure`, and
 * accepts `opencode run --help`. Help is read from stdout and stderr because
 * OpenCode 1.18.9 writes `--help` to stderr.
 */
export function verifyReviewedOpenCodeCliIdentity({
  executable,
  expectedVersion,
  spawn = spawnSync,
  env,
}) {
  if (
    typeof executable !== 'string' ||
    executable.length === 0 ||
    typeof expectedVersion !== 'string' ||
    !REVIEWED_OPENCODE_VERSION_PATTERN.test(expectedVersion)
  ) {
    return invalid();
  }

  const isolated = env ?? createIsolatedOpenCodeEnvironment();
  const versionResult = inquire(spawn, executable, ['--version'], isolated);
  const version = readOpenCodeVersionLine(versionResult.stdout);
  if (versionResult.status !== 0 || !version.includes(expectedVersion)) {
    return invalid();
  }

  const helpResult = inquire(spawn, executable, ['--help'], isolated);
  const helpText = `${helpResult.stdout ?? ''}${helpResult.stderr ?? ''}`;
  if (helpResult.status !== 0 || !helpText.includes('--pure')) {
    return invalid();
  }

  const runHelpResult = inquire(spawn, executable, ['run', '--help'], isolated);
  if (runHelpResult.status !== 0) {
    return invalid();
  }

  return Object.freeze({
    executable,
    version,
  });
}
