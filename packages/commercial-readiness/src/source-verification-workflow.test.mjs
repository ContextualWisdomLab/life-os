import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SOURCE_REF =
  'ref: ${{ github.event.pull_request.head.sha || github.sha }}';
const ADVERTISED_MERGE_REF =
  'ref: refs/pull/${{ github.event.pull_request.number }}/merge';
const LIVE_SOURCE_REF =
  'ref: ${{ steps.live-identities.outputs.current_source }}';
const SARIF_SOURCE_REF =
  "ref: ${{ github.event_name == 'pull_request' && format('refs/pull/{0}/head', github.event.pull_request.number) || github.ref }}";
const SARIF_SOURCE_SHA =
  'sha: ${{ github.event.pull_request.head.sha || github.sha }}';

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

/** Finds one unique named workflow step by its exact YAML sequence entry. */
function stepStartIndex(job, stepName) {
  const lines = job.split('\n');
  const matches = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim() === `- name: ${stepName}`) {
      matches.push(index);
    }
  }
  assert.equal(
    matches.length,
    1,
    `expected exactly one step ${stepName}, found ${matches.length}`,
  );
  return matches[0];
}

/** Extracts one named workflow step from an already bounded job block. */
function stepBlock(job, stepName) {
  const lines = job.split('\n');
  const start = stepStartIndex(job, stepName);
  const startMatch = /^(\s*)-\s/u.exec(lines[start]);
  assert.ok(startMatch, `invalid step indentation for ${stepName}`);
  const stepIndent = startMatch[1];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const siblingStep = /^(\s*)-\s/u.exec(lines[index]);
    if (siblingStep?.[1] === stepIndent) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Requires one exact named workflow step to occur before another. */
function assertStepPrecedes(job, earlierStepName, laterStepName) {
  assert.ok(
    stepStartIndex(job, earlierStepName) < stepStartIndex(job, laterStepName),
    `${earlierStepName} must precede ${laterStepName}`,
  );
}

/** Finds executable uses entries for one exact GitHub Action identity. */
function actionUseLines(workflowBlock, actionName) {
  const usesEntry = /^uses:\s*(['"]?)([^'"\s#]+)\1(?:\s+#.*)?$/u;
  return workflowBlock
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => {
      if (line.startsWith('#')) {
        return false;
      }
      const match = usesEntry.exec(line);
      return match?.[2].startsWith(`${actionName}@`) ?? false;
    });
}

/** Requires one action invocation and binds it to the reviewed named step. */
function assertUniqueActionUseInStep(job, actionName, stepName) {
  const jobUses = actionUseLines(job, actionName);
  assert.equal(
    jobUses.length,
    1,
    `expected exactly one ${actionName} use, found ${jobUses.length}`,
  );
  assert.equal(
    actionUseLines(stepBlock(job, stepName), actionName).length,
    1,
    `${actionName} must be owned by ${stepName}`,
  );
}

test('step extraction does not borrow evidence from unnamed sibling steps', () => {
  const job = [
    '  scan:',
    '    steps:',
    '      - name: Materialize AppGuardrail SARIF PR merge provenance',
    '        run: echo target-step',
    '      - run: echo sibling-sentinel',
    '      - uses: actions/upload-artifact@example',
  ].join('\n');

  const block = stepBlock(
    job,
    'Materialize AppGuardrail SARIF PR merge provenance',
  );
  assert.ok(block.includes('target-step'));
  assert.equal(
    block.includes('sibling-sentinel'),
    false,
    'a named step must not satisfy its contract from a later unnamed sibling step',
  );
});

test('step ordering ignores comments that only mention a step name', () => {
  const job = [
    '  scan:',
    '    steps:',
    '      # stale note: - name: Materialize AppGuardrail SARIF PR merge provenance',
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        run: echo upload',
    '      - name: Materialize AppGuardrail SARIF PR merge provenance',
    '        run: echo provenance',
  ].join('\n');

  assert.throws(
    () =>
      assertStepPrecedes(
        job,
        'Materialize AppGuardrail SARIF PR merge provenance',
        'Upload AppGuardrail SARIF to code scanning',
      ),
    /must precede/u,
  );
});

test('step lookup rejects duplicate authority-bearing step names', () => {
  const job = [
    '  scan:',
    '    steps:',
    '      - name: Upload AppGuardrail SARIF to code scanning',
    `        ${SARIF_SOURCE_REF}`,
    `        ${SARIF_SOURCE_SHA}`,
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        uses: github/codeql-action/upload-sarif@example',
  ].join('\n');

  assert.throws(
    () => stepBlock(job, 'Upload AppGuardrail SARIF to code scanning'),
    /exactly one step/u,
  );
});

test('SARIF upload authority rejects differently named duplicate action uses', () => {
  const job = [
    '  scan:',
    '    steps:',
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        uses: github/codeql-action/upload-sarif@reviewed-sha',
    '        with:',
    `          ${SARIF_SOURCE_REF}`,
    `          ${SARIF_SOURCE_SHA}`,
    '      - name: Upload alternate SARIF',
    '        uses: "github/codeql-action/upload-sarif@unreviewed-sha"',
    '        with:',
    '          sarif_file: alternate.sarif',
  ].join('\n');

  assert.throws(
    () =>
      assertUniqueActionUseInStep(
        job,
        'github/codeql-action/upload-sarif',
        'Upload AppGuardrail SARIF to code scanning',
      ),
    /exactly one github\/codeql-action\/upload-sarif use/u,
  );
});

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

  const sarifProvenance = stepBlock(
    appguardrail,
    'Materialize AppGuardrail SARIF PR merge provenance',
  );
  assert.ok(
    sarifProvenance.includes("github.event_name == 'pull_request'"),
    'AppGuardrail SARIF provenance must run only for pull_request events',
  );
  assert.ok(
    sarifProvenance.includes(
      'github.event.pull_request.head.repo.full_name == github.repository',
    ),
    'AppGuardrail SARIF provenance must be limited to same-repository pull requests',
  );
  assert.ok(
    sarifProvenance.includes(
      'PR_NUMBER: ${{ github.event.pull_request.number }}',
    ),
    'AppGuardrail SARIF provenance is not bound to the pull request number',
  );
  assert.ok(
    sarifProvenance.includes('EXPECTED_MERGE_SHA: ${{ github.sha }}'),
    'AppGuardrail SARIF provenance is not bound to the advertised merge SHA',
  );
  assert.ok(
    sarifProvenance.includes(
      'git fetch --no-tags --depth=1 origin "$merge_ref"',
    ),
    'AppGuardrail SARIF provenance must fetch only the bounded PR merge ref',
  );
  assert.ok(
    sarifProvenance.includes('git rev-parse FETCH_HEAD'),
    'AppGuardrail SARIF provenance must verify the fetched merge identity',
  );
  assert.ok(
    sarifProvenance.includes(
      'git cat-file -e "${EXPECTED_MERGE_SHA}^{commit}"',
    ),
    'AppGuardrail SARIF provenance must verify the merge commit object locally',
  );
  assert.equal(
    sarifProvenance.includes('fetch-depth: 0'),
    false,
    'AppGuardrail SARIF provenance must not broaden checkout history',
  );
  assert.equal(
    sarifProvenance.includes('git checkout'),
    false,
    'AppGuardrail SARIF provenance must not replace the analyzed contributor head',
  );

  const sarifUpload = stepBlock(
    appguardrail,
    'Upload AppGuardrail SARIF to code scanning',
  );
  assertUniqueActionUseInStep(
    appguardrail,
    'github/codeql-action/upload-sarif',
    'Upload AppGuardrail SARIF to code scanning',
  );
  assertStepPrecedes(
    appguardrail,
    'Materialize AppGuardrail SARIF PR merge provenance',
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
  assert.ok(
    block.includes('/commits/${{ github.event.pull_request.base.ref }}'),
  );
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
