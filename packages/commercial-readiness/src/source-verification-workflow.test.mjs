import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_REF = 'ref: ${{ github.event.pull_request.head.sha || github.sha }}';
const ADVERTISED_MERGE_REF =
  'ref: refs/pull/${{ github.event.pull_request.number }}/merge';
const LIVE_SOURCE_REF =
  'ref: ${{ steps.live-identities.outputs.current_source }}';
const SARIF_SOURCE_REF =
  "ref: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}";
const SARIF_SOURCE_SHA = 'sha: ${{ github.event.pull_request.head.sha || github.sha }}';

/** Reads one repository workflow as UTF-8 text. */
function readWorkflow(name) {
  return readFileSync(join(REPOSITORY_ROOT, '.github/workflows', name), 'utf8');
}

/** Extracts one top-level workflow job without requiring a YAML parser. */
function jobBlock(workflow, jobName) {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  assert.notEqual(start, -1, `missing job ${jobName}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*$/u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Extracts one named workflow step from an already bounded job block. */
function stepBlock(job, stepName) {
  const lines = job.split('\n');
  const start = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.notEqual(start, -1, `missing step ${stepName}`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s+- name: /u.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

test('required source-verification jobs explicitly checkout the contributor head', () => {
  const ci = readWorkflow('ci.yml');
  for (const jobName of [
    'compose_runtime',
    'today-concurrency',
    'validate',
    'browser-acceptance',
  ]) {
    const block = jobBlock(ci, jobName);
    assert.ok(
      block.includes(SOURCE_REF),
      `${jobName} is not bound to the contributor head`,
    );
    assert.equal(
      block.includes(ADVERTISED_MERGE_REF),
      false,
      `${jobName} must not use the synthetic merge ref`,
    );
  }

  const appguardrail = jobBlock(readWorkflow('appguardrail.yml'), 'scan');
  assert.ok(
    appguardrail.includes(SOURCE_REF),
    'AppGuardrail is not bound to the contributor head',
  );

  const sarifUpload = stepBlock(
    appguardrail,
    'Upload AppGuardrail SARIF to code scanning',
  );
  assert.ok(
    sarifUpload.includes(SARIF_SOURCE_REF),
    'AppGuardrail SARIF ref is not bound to the analyzed contributor head',
  );
  assert.ok(
    sarifUpload.includes(SARIF_SOURCE_SHA),
    'AppGuardrail SARIF SHA is not bound to the analyzed contributor head',
  );

  const readiness = jobBlock(readWorkflow('commercial-readiness.yml'), 'audit');
  assert.ok(
    readiness.includes(SOURCE_REF),
    'Commercial Readiness is not bound to the contributor head',
  );
});

test('merge compatibility reconstructs a fresh integration tree from current API identities', () => {
  const block = jobBlock(readWorkflow('ci.yml'), 'merge_compatibility');
  assert.ok(block.includes("if: github.event_name == 'pull_request'"));
  assert.ok(block.includes('id: live-identities'));
  assert.ok(block.includes('GITHUB_TOKEN: ${{ github.token }}'));
  assert.ok(block.includes('/pulls/${{ github.event.pull_request.number }}'));
  assert.ok(block.includes('/commits/${{ github.event.pull_request.base.ref }}'));
  assert.ok(block.includes(LIVE_SOURCE_REF));
  assert.ok(
    block.includes('fetch-depth: 0'),
    'the integration job must have both current commits available locally',
  );
  assert.ok(block.includes('git checkout --detach "$current_base"'));
  assert.ok(
    block.includes("git -c user.name='LifeOS integration verifier'"),
    'the non-committing merge must provide a bounded command-local identity',
  );
  assert.ok(
    block.includes("-c user.email='integration-verifier@life-os.invalid'"),
    'the verifier identity must remain local to the merge command',
  );
  assert.ok(block.includes('merge --no-commit --no-ff "$current_source"'));
  assert.ok(
    block.includes('latest_source'),
    'the job must re-resolve source identity after constructing the integration tree',
  );
  assert.ok(
    block.includes('latest_base'),
    'the job must re-resolve live-base identity after constructing the integration tree',
  );
  assert.equal(
    block.includes(ADVERTISED_MERGE_REF),
    false,
    'rerun-safe integration evidence must not depend on a stale advertised pull merge ref',
  );
  assert.equal(
    block.includes('git config --global'),
    false,
    'verification must not persist a global author identity on the runner',
  );
  assert.equal(
    block.includes('git ls-remote'),
    false,
    'merge identity must not depend on unauthenticated advertised refs',
  );
  assert.equal(
    block.includes('${{ github.sha }}'),
    false,
    'integration evidence must not treat stale event github.sha as live-base authority',
  );
});

test('merge-tree compatibility provisions the PostgreSQL contract required by the full suite', () => {
  const block = jobBlock(readWorkflow('ci.yml'), 'merge_compatibility');
  assert.ok(block.includes('services:'));
  assert.ok(block.includes('postgres:'));
  assert.ok(block.includes('POSTGRES_DB: life_os_test'));
  for (const variableName of [
    'AI_DATABASE_URL',
    'AI_TEST_DATABASE_URL',
    'IDENTITY_DATABASE_URL',
    'PLANNING_DATABASE_URL',
    'HABIT_DATABASE_URL',
    'NOTIFICATION_DATABASE_URL',
    'PRIVACY_DATABASE_URL',
  ]) {
    assert.ok(
      block.includes(
        `${variableName}: postgresql://postgres:postgres@127.0.0.1:5432/life_os_test`,
      ),
      `merge_compatibility is missing ${variableName}`,
    );
  }
});
