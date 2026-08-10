import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_REF = 'ref: ${{ github.event.pull_request.head.sha || github.sha }}';
const MERGE_REF = 'ref: refs/pull/${{ github.event.pull_request.number }}/merge';

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
      block.includes(MERGE_REF),
      false,
      `${jobName} must not use the synthetic merge ref`,
    );
  }

  const appguardrail = jobBlock(readWorkflow('appguardrail.yml'), 'scan');
  assert.ok(
    appguardrail.includes(SOURCE_REF),
    'AppGuardrail is not bound to the contributor head',
  );

  const readiness = jobBlock(readWorkflow('commercial-readiness.yml'), 'audit');
  assert.ok(
    readiness.includes(SOURCE_REF),
    'Commercial Readiness is not bound to the contributor head',
  );
});

test('CI retains an explicit pull-request merge-tree compatibility signal', () => {
  const mergeCompatibility = jobBlock(readWorkflow('ci.yml'), 'merge_compatibility');
  assert.ok(mergeCompatibility.includes("if: github.event_name == 'pull_request'"));
  assert.ok(mergeCompatibility.includes(MERGE_REF));
  assert.ok(mergeCompatibility.includes('git rev-parse HEAD'));
  assert.ok(mergeCompatibility.includes('${{ github.sha }}'));
});
