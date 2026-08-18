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

describe('OpenCode commercial development workflow contract', () => {
  it('runs hourly and manually with one bounded single-flight job', () => {
    expect(workflow).toContain("    - cron: '11 * * * *'");
    expect(workflow).toContain('  workflow_dispatch:');
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).toContain('permissions: {}');
    expect(workflow).toContain(
      'group: opencode-commercial-development-${{ github.repository }}',
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes: 120');
  });

  it('initializes runner temp only after the runner starts', () => {
    const jobsStart = workflow.indexOf('\njobs:\n');
    const stepsStart = workflow.indexOf('\n    steps:\n', jobsStart);
    expect(jobsStart).toBeGreaterThanOrEqual(0);
    expect(stepsStart).toBeGreaterThan(jobsStart);
    expect(workflow.slice(0, stepsStart)).not.toContain('${{ runner.');

    const evidence = step('Prepare private evidence directory');
    expect(evidence).toContain(
      'receipt_dir="$RUNNER_TEMP/commercial-development"',
    );
    expect(evidence).toContain(
      'echo "RECEIPT_DIR=$receipt_dir" >> "$GITHUB_ENV"',
    );
  });

  it('paginates GitHub evidence into one fail-closed JSON array per resource', () => {
    const evidence = step(
      'Collect bounded GitHub issue and pull request evidence',
    );

    expect(evidence).toContain('set -Eeuo pipefail');
    expect(evidence.match(/--paginate/gu)).toHaveLength(2);
    expect(evidence.match(/\| jq -s '\.'/gu)).toHaveLength(2);
    expect(evidence).not.toContain("--jq '[.[]");
    expect(evidence).toContain('> "$RECEIPT_DIR/issues.json"');
    expect(evidence).toContain('> "$RECEIPT_DIR/pulls.json"');
  });

  it('provisions the same disposable PostgreSQL boundary used by full CI', () => {
    expect(workflow).toContain(
      'AI_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/life_os_test',
    );
    expect(workflow).toContain(
      'PRIVACY_DATABASE_URL: postgresql://postgres:postgres@127.0.0.1:5432/life_os_test',
    );
    expect(workflow).toContain('services:');
    expect(workflow).toContain(
      'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777',
    );
    expect(workflow).toContain('pg_isready -U postgres -d life_os_test');
  });

  it('pins every external action and the reviewed OpenCode package exactly', () => {
    const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(
      (match) => match[1] ?? '',
    );
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const action of uses) {
      expect(action).toMatch(/^[^@\s]+@[0-9a-f]{40}$/u);
    }
    expect(workflow).toContain(
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    );
    expect(workflow).toContain(
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    );
    expect(workflow).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    expect(packageJson.devDependencies['opencode-ai']).toMatch(
      /^[0-9]+\.[0-9]+\.[0-9]+$/u,
    );
    expect(workflow).toContain(
      `OPENCODE_PACKAGE_VERSION: '${packageJson.devDependencies['opencode-ai']}'`,
    );
    expect(workflow).not.toContain('__PINNED_BY_BOOTSTRAP__');
    expect(step('Verify the exact OpenCode installation')).toContain(
      'packages/commercial-development-agent/src/verify-opencode-identity.mjs',
    );
    expect(step('Verify the exact OpenCode installation')).toContain(
      'unset NODE_OPTIONS',
    );
    expect(step('Verify the exact OpenCode installation')).not.toContain(
      'exec opencode --version',
    );
    expect(step('Verify the exact OpenCode installation')).not.toContain(
      'exec opencode --help',
    );
    expect(workflow).not.toMatch(/curl[^\n]*\|\s*(?:sh|bash)/iu);
  });
