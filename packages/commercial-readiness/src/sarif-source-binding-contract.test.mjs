import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SARIF_SOURCE_REF =
  "ref: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}";
const SARIF_SOURCE_SHA =
  'sha: ${{ github.event.pull_request.head.sha || github.sha }}';
const UPLOAD_STEP_NAME = 'Upload AppGuardrail SARIF to code scanning';

/** Extracts one uniquely named workflow step at the direct steps-sequence depth. */
function namedStep(workflow, stepName) {
  const lines = workflow.split('\n');
  const stepsIndex = lines.findIndex((line) => /^\s+steps:\s*$/u.test(line));
  assert.notEqual(stepsIndex, -1, 'workflow must contain a steps mapping');
  const stepsIndent = /^(\s*)steps:\s*$/u.exec(lines[stepsIndex])?.[1];
  assert.notEqual(stepsIndent, undefined, 'workflow steps indentation is invalid');
  const stepIndent = `${stepsIndent}  `;
  const expected = `${stepIndent}- name: ${stepName}`;
  const matches = [];
  for (let index = stepsIndex + 1; index < lines.length; index += 1) {
    if (lines[index] === expected) {
      matches.push(index);
    }
  }
  assert.equal(matches.length, 1, `expected exactly one step ${stepName}`);

  const start = matches[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith(`${stepIndent}- `)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Extracts one direct child mapping from a workflow step without borrowing sibling mappings. */
function directMapping(step, mappingName) {
  const lines = step.split('\n');
  const stepMatch = /^(\s*)-\s/u.exec(lines[0]);
  assert.ok(stepMatch, 'workflow step indentation is invalid');
  const directIndent = `${stepMatch[1]}  `;
  const mappingLine = `${directIndent}${mappingName}:`;
  const matches = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === mappingLine) {
      matches.push(index);
    }
  }
  assert.equal(
    matches.length,
    1,
    `expected exactly one direct ${mappingName} mapping`,
  );

  const start = matches[0] + 1;
  let end = lines.length;
  for (let index = start; index < lines.length; index += 1) {
    if (!lines[index].startsWith(`${directIndent}  `)) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end);
}

/** Requires contributor-head ref and sha to be direct upload-sarif with inputs. */
function assertSarifSourceBinding(uploadStep) {
  const withEntries = directMapping(uploadStep, 'with');
  assert.ok(
    withEntries.includes(`          ${SARIF_SOURCE_REF}`),
    'SARIF upload must bind ref to the analyzed contributor head in direct with inputs',
  );
  assert.ok(
    withEntries.includes(`          ${SARIF_SOURCE_SHA}`),
    'SARIF upload must bind sha to the analyzed contributor head in direct with inputs',
  );
}

test('AppGuardrail SARIF upload binds contributor identity through direct with inputs', () => {
  const workflow = readFileSync(
    join(REPOSITORY_ROOT, '.github/workflows/appguardrail.yml'),
    'utf8',
  );
  const uploadStep = namedStep(workflow, UPLOAD_STEP_NAME);

  assert.doesNotThrow(() => assertSarifSourceBinding(uploadStep));
});

test('SARIF source binding rejects contributor markers moved outside direct with entries', () => {
  const hostileUploadStep = [
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        uses: github/codeql-action/upload-sarif@reviewed-sha',
    '        env:',
    `          SARIF_REF_MARKER: "${SARIF_SOURCE_REF}"`,
    `          SARIF_SHA_MARKER: "${SARIF_SOURCE_SHA}"`,
    '        with:',
    '          sarif_file: appguardrail.sarif',
  ].join('\n');

  assert.throws(
    () => assertSarifSourceBinding(hostileUploadStep),
    /must bind ref/u,
    'authority-looking ref/sha text outside with: must not satisfy upload input binding',
  );
});
