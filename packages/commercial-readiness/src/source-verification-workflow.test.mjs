import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_REF = 'ref: ${{ github.event.pull_request.head.sha || github.sha }}';
const MERGE_REF = 'ref: refs/pull/${{ github.event.pull_request.number }}/merge';
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
    assert.ok(block.includes(SOURCE_REF), `${jobName} is not bound to the contributor head`);
    assert.equal(block.includes(MERGE_REF), false, `${jobName} must not use the synthetic merge ref`);
  }

  const appguardrail = jobBlock(readWorkflow('appguardrail.yml'), 'scan');
  assert.ok(appguardrail.includes(SOURCE_REF), 'AppGuardrail is not bound to the contributor head');

  const sarifUpload = stepBlock(appguardrail, 'Upload AppGuardrail SARIF to code scanning');
  assert.ok(sarifUpload.includes(SARIF_SOURCE_REF), 'AppGuardrail SARIF ref is not bound to the analyzed contributor head');
  assert.ok(sarifUpload.includes(SARIF_SOURCE_SHA), 'AppGuardrail SARIF SHA is not bound to the analyzed contributor head');

  const readiness = jobBlock(readWorkflow('commercial-readiness.yml'), 'audit');
  assert.ok(readiness.includes(SOURCE_REF), 'Commercial Readiness is not bound to the contributor head');
});

test('merge compatibility binds a freshly resolved merge ref to current head and live base', () => {
  const block = jobBlock(readWorkflow('ci.yml'), 'merge_compatibility');
  assert.ok(block.includes("if: github.event_name == 'pull_request'"));
  assert.ok(block.includes(MERGE_REF));
  assert.ok(block.includes('git ls-remote origin'));
  assert.ok(block.includes('refs/pull/${{ github.event.pull_request.number }}/head'));
  assert.ok(block.includes('refs/heads/${{ github.event.pull_request.base.ref }}'));
  assert.ok(block.includes('refs/pull/${{ github.event.pull_request.number }}/merge'));
  assert.ok(block.includes('git show -s --format=%P HEAD'));
  assert.ok(block.includes('${{ github.event.pull_request.head.sha }}'));
  assert.equal(
    block.includes('actual_commit" != "${{ github.sha }}"'),
    false,
    'a regenerated live merge ref must not be compared to stale event github.sha',
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
      block.includes(`${variableName}: postgresql://postgres:postgres@127.0.0.1:5432/life_os_test`),
      `merge_compatibility is missing ${variableName}`,
    );
  }
});
