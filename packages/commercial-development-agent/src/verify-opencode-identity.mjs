#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readPinnedOpenCodePackageVersion,
  resolveReviewedOpenCodeExecutable,
  verifyReviewedOpenCodeCliIdentity,
} from './opencode-identity.mjs';

const packageRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const pinned = readPinnedOpenCodePackageVersion(
  resolve(packageRoot, 'package.json'),
);
const expected = process.env.OPENCODE_PACKAGE_VERSION;
if (expected !== pinned) {
  process.stderr.write(
    'Workflow OpenCode pin does not match the reviewed package pin.\n',
  );
  process.exitCode = 1;
} else {
  try {
    const identity = verifyReviewedOpenCodeCliIdentity({
      executable: resolveReviewedOpenCodeExecutable(
        resolve(packageRoot, 'node_modules/opencode-ai'),
      ),
      expectedVersion: pinned,
    });
    process.stdout.write(`${identity.version}\n`);
  } catch {
    process.stderr.write(
      'Installed OpenCode version does not match the reviewed package pin.\n',
    );
    process.exitCode = 1;
  }
}
