#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPinnedOpenCodePackageVersion,
  resolveReviewedOpenCodeExecutable,
  verifyReviewedOpenCodeCliIdentity,
} from './opencode-identity.mjs';

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PACKAGE_ROOT = resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '..',
);
const PIN_MISMATCH_MESSAGE =
  'Workflow OpenCode pin does not match the reviewed package pin.\n';
const IDENTITY_FAILURE_MESSAGE =
  'Installed OpenCode version does not match the reviewed package pin.\n';

/**
 * Verifies the workflow pin and installed OpenCode identity without retaining
 * stack traces or private filesystem details.
 */
export function verifyOpenCodeInstallation({
  packageRoot = DEFAULT_PACKAGE_ROOT,
  expectedVersion = process.env.OPENCODE_PACKAGE_VERSION,
  readPinnedVersion = readPinnedOpenCodePackageVersion,
  resolveExecutable = resolveReviewedOpenCodeExecutable,
  verifyIdentity = verifyReviewedOpenCodeCliIdentity,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const pinned = readPinnedVersion(resolve(packageRoot, 'package.json'));
    if (expectedVersion !== pinned) {
      stderr.write(PIN_MISMATCH_MESSAGE);
      return 1;
    }

    const identity = verifyIdentity({
      executable: resolveExecutable(
        resolve(packageRoot, 'node_modules/opencode-ai'),
      ),
      expectedVersion: pinned,
    });
    stdout.write(`${identity.version}\n`);
    return 0;
  } catch {
    stderr.write(IDENTITY_FAILURE_MESSAGE);
    return 1;
  }
}

if (process.argv[1] === MODULE_PATH) {
  process.exitCode = verifyOpenCodeInstallation();
}
