import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const PROVENANCE_STEP_NAME =
  'Materialize AppGuardrail SARIF PR merge provenance';
const PULL_REQUEST_CONDITION = "github.event_name == 'pull_request'";
const SAME_REPOSITORY_CONDITION =
  'github.event.pull_request.head.repo.full_name == github.repository';
const EXPECTED_PROVENANCE_CONDITION = `${PULL_REQUEST_CONDITION} && ${SAME_REPOSITORY_CONDITION}`;

/** Extracts one uniquely named real workflow step at its YAML sequence indentation. */
function namedStep(workflow, stepName) {
  const lines = workflow.split('\n');
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)- name: (.+)$/u.exec(lines[index]);
    if (match?.[2] === stepName) {
      matches.push({ index, indent: match[1] });
    }
  }
  assert.equal(
    matches.length,
    1,
    `expected exactly one workflow step ${stepName}`,
  );

  const { index: start, indent } = matches[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith(`${indent}- `)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Reads one unique direct scalar key from a workflow step and normalizes folded block text. */
function directScalar(step, key) {
  const lines = step.split('\n');
  const stepMatch = /^(\s*)-\s/u.exec(lines[0]);
  assert.ok(stepMatch, 'workflow step indentation is invalid');
  const directIndent = `${stepMatch[1]}  `;
  const prefix = `${directIndent}${key}:`;
  const matches = [];

  for (let index = 1; index < lines.length; index += 1) {
    if (!lines[index].startsWith(prefix)) {
      continue;
    }
    const suffix = lines[index].slice(prefix.length);
    if (suffix.length === 0 || /^\s/u.test(suffix)) {
      matches.push({ index, suffix: suffix.trim() });
    }
  }
  assert.equal(matches.length, 1, `expected exactly one direct ${key} key`);

  const { index, suffix } = matches[0];
  if (!/^[>|][+-]?$/u.test(suffix)) {
    return suffix;
  }

  const body = [];
  for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex += 1) {
    const line = lines[bodyIndex];
    if (line.trim().length === 0) {
      continue;
    }
    const leading = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (leading <= directIndent.length) {
      break;
    }
    body.push(line.trim());
  }
  assert.notEqual(body.length, 0, `direct ${key} block scalar must not be empty`);
  return body.join(' ');
}

/** Requires the provenance restriction to live in the step's direct if key. */
function assertProvenanceGuard(step) {
  assert.equal(
    directScalar(step, 'if'),
    EXPECTED_PROVENANCE_CONDITION,
    'provenance step must require pull_request and same-repository authority in its direct if guard',
  );
}

test('AppGuardrail provenance step owns the exact same-repository pull_request guard', () => {
  const workflow = readFileSync(
    join(REPOSITORY_ROOT, '.github/workflows/appguardrail.yml'),
    'utf8',
  );
  assert.doesNotThrow(() =>
    assertProvenanceGuard(namedStep(workflow, PROVENANCE_STEP_NAME)),
  );
});

test('provenance condition rejects guard strings that exist only outside the if key', () => {
  const hostileStep = [
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        if: always()',
    `        # ${PULL_REQUEST_CONDITION}`,
    '        run: |',
    `          echo "${SAME_REPOSITORY_CONDITION}"`,
  ].join('\n');

  assert.throws(
    () => assertProvenanceGuard(hostileStep),
    /direct if guard/u,
    'comments or run-block text must not satisfy the provenance guard contract',
  );
});

test('provenance condition rejects duplicate direct if authority', () => {
  const hostileStep = [
    `      - name: ${PROVENANCE_STEP_NAME}`,
    '        if: >-',
    `          ${PULL_REQUEST_CONDITION}`,
    `          && ${SAME_REPOSITORY_CONDITION}`,
    '        if: always()',
    '        run: echo duplicate-if',
  ].join('\n');

  assert.throws(
    () => assertProvenanceGuard(hostileStep),
    /exactly one direct if key/u,
  );
});
