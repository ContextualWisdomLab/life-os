import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-commercial-development.yml',
);
const CI_WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/ci.yml',
);
const COMPOSE_PATH = resolve(import.meta.dirname, '../../../compose.yaml');
const PACKAGE_PATH = resolve(import.meta.dirname, '../package.json');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const ciWorkflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');
const compose = readFileSync(COMPOSE_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));
const linuxX64Test =
  process.platform === 'linux' && process.arch === 'x64' ? it : it.skip;

/** Returns one named workflow step including its body but not the next step. */
function namedStep(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n      - name: ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

/** Returns one named OpenCode workflow step. */
function step(name) {
  return namedStep(workflow, name);
}

/** Returns one top-level CI job including its body but not the next job. */
function ciJob(name) {
  const marker = `  ${name}:\n`;
  const start = ciWorkflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const remainder = ciWorkflow.slice(start + marker.length);
  const next = remainder.search(/^  [a-z][a-z0-9_]*:\n/mu);
  return ciWorkflow.slice(
    start,
    next === -1 ? ciWorkflow.length : start + marker.length + next,
  );
}
