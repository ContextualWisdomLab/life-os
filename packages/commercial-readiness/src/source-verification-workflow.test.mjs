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
const DIRECT_JOB_ENTRY =
  /^  (?:([A-Za-z_][A-Za-z0-9_-]*)|"([A-Za-z_][A-Za-z0-9_-]*)"|'([A-Za-z_][A-Za-z0-9_-]*)'):\s*(?:#.*)?$/u;

/** Reads one repository workflow as UTF-8 text. */
function readWorkflow(name) {
  return readFileSync(join(REPOSITORY_ROOT, '.github/workflows', name), 'utf8');
}

/** Returns the canonical job ID for one direct job entry, or null for non-job lines. */
function directJobName(line) {
  const match = DIRECT_JOB_ENTRY.exec(line);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

/** Extracts one direct job only from the workflow's top-level jobs mapping. */
function jobBlock(workflow, jobName) {
  const lines = workflow.split('\n');
  const jobsIndexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === 'jobs:') {
      jobsIndexes.push(index);
    }
  }
  assert.equal(
    jobsIndexes.length,
    1,
    'workflow must contain exactly one top-level jobs mapping',
  );

  const jobsStart = jobsIndexes[0];
  let jobsEnd = lines.length;
  for (let index = jobsStart + 1; index < lines.length; index += 1) {
    if (/^[^\s#]/u.test(lines[index])) {
      jobsEnd = index;
      break;
    }
  }

  const matches = [];
  for (let index = jobsStart + 1; index < jobsEnd; index += 1) {
    if (directJobName(lines[index]) === jobName) {
      matches.push(index);
    }
  }
  assert.equal(
    matches.length,
    1,
    `expected exactly one workflow job ${jobName}`,
  );

  const start = matches[0];
  let end = jobsEnd;
  for (let index = start + 1; index < jobsEnd; index += 1) {
    if (directJobName(lines[index]) !== null) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Resolves the bounded direct steps sequence inside one workflow job. */
function stepsSection(job) {
  const lines = job.split('\n');
  const jobEntry = /^(\s*)[A-Za-z0-9_-]+:\s*$/u.exec(lines[0]);
  assert.ok(jobEntry, 'invalid bounded workflow job');
  const directJobMemberIndent = `${jobEntry[1]}  `;
  const stepIndent = `${jobEntry[1]}    `;
  const stepsLine = `${directJobMemberIndent}steps:`;
  const stepsIndexes = [];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === stepsLine) {
      stepsIndexes.push(index);
    }
  }
  assert.equal(
    stepsIndexes.length,
    1,
    'expected exactly one direct steps mapping in bounded workflow job',
  );

  const start = stepsIndexes[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    if (
      line.startsWith(directJobMemberIndent) &&
      !line.startsWith(stepIndent)
    ) {
      end = index;
      break;
    }
  }

  return { lines, start, end, stepIndent };
}

/** Finds one unique named workflow step at the real steps sequence depth. */
function stepStartIndex(job, stepName) {
  const { lines, start, end, stepIndent } = stepsSection(job);
  const expected = `${stepIndent}- name: ${stepName}`;
  const matches = [];
  for (let index = start + 1; index < end; index += 1) {
    if (lines[index] === expected) {
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
  const { lines, end: stepsEnd, stepIndent } = stepsSection(job);
  const start = stepStartIndex(job, stepName);
  let end = stepsEnd;
  for (let index = start + 1; index < stepsEnd; index += 1) {
    if (lines[index].startsWith(`${stepIndent}- `)) {
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

/** Matches GitHub Action repository identity case-insensitively while preserving subpath spelling. */
function matchesActionIdentity(uses, actionName) {
  const refSeparator = uses.indexOf('@');
  if (refSeparator <= 0) {
    return false;
  }

  const candidate = uses.slice(0, refSeparator).split('/');
  const reviewed = actionName.split('/');
  if (candidate.length !== reviewed.length || candidate.length < 2) {
    return false;
  }

  return (
    candidate[0].toLowerCase() === reviewed[0].toLowerCase() &&
    candidate[1].toLowerCase() === reviewed[1].toLowerCase() &&
    candidate.slice(2).every((segment, index) => segment === reviewed[index + 2])
  );
}

/** Finds executable action uses only from real step entries and direct step keys. */
function actionUses(job, actionName) {
  const {
    lines,
    start: stepsStart,
    end: stepsEnd,
    stepIndent,
  } = stepsSection(job);
  const directKeyIndent = `${stepIndent}  `;
  const usesEntry = /^uses:\s*(['"]?)([^'"\s#]+)\1(?:\s+#.*)?$/u;
  const uses = [];

  for (let index = stepsStart + 1; index < stepsEnd; index += 1) {
    if (!lines[index].startsWith(`${stepIndent}- `)) {
      continue;
    }

    const inline = usesEntry.exec(lines[index].slice(`${stepIndent}- `.length));
    if (inline?.[2] && matchesActionIdentity(inline[2], actionName)) {
      uses.push({ line: lines[index], stepStart: index });
    }

    let end = stepsEnd;
    for (let sibling = index + 1; sibling < stepsEnd; sibling += 1) {
      if (lines[sibling].startsWith(`${stepIndent}- `)) {
        end = sibling;
        break;
      }
    }
    for (let child = index + 1; child < end; child += 1) {
      const direct = lines[child].slice(directKeyIndent.length);
      if (!lines[child].startsWith(directKeyIndent) || direct.startsWith(' ')) {
        continue;
      }
      const match = usesEntry.exec(direct);
      if (match?.[2] && matchesActionIdentity(match[2], actionName)) {
        uses.push({ line: lines[child], stepStart: index });
      }
    }
  }

  return uses;
}

/** Requires one action invocation and binds it to the reviewed named step. */
function assertUniqueActionUseInStep(job, actionName, stepName) {
  const jobUses = actionUses(job, actionName);
  assert.equal(
    jobUses.length,
    1,
    `expected exactly one ${actionName} use, found ${jobUses.length}`,
  );
  assert.equal(
    jobUses[0].stepStart,
    stepStartIndex(job, stepName),
    `${actionName} must be owned by ${stepName}`,
  );
}

test('job extraction does not borrow authority from quoted or commented sibling jobs', () => {
  for (const sibling of [
    '  "decoy":',
    "  'decoy': # sibling",
    '  decoy: # sibling',
  ]) {
    const workflow = [
      'jobs:',
      '  scan:',
      sibling,
      '    steps:',
      '      - name: Upload AppGuardrail SARIF to code scanning',
      '        uses: github/codeql-action/upload-sarif@fake-sha',
    ].join('\n');

    assert.equal(
      jobBlock(workflow, 'scan'),
      '  scan:',
      'a bounded job must stop before every direct sibling job spelling',
    );
  }
});

test('job extraction ignores job-shaped text outside the top-level jobs mapping', () => {
  const workflow = [
    'name: |',
    '  scan:',
    '    steps:',
    '      - name: Materialize AppGuardrail SARIF PR merge provenance',
    '        run: echo fake-job-authority',
    'jobs:',
    '  scan:',
    '    steps:',
    '      - name: Harmless real step',
    '        run: echo real-job-authority',
  ].join('\n');

  const block = jobBlock(workflow, 'scan');
  assert.ok(block.includes('Harmless real step'));
  assert.equal(
    block.includes('fake-job-authority'),
    false,
    'job authority must come only from the top-level jobs mapping',
  );
});

test('step extraction does not borrow authority from job-level block scalar text', () => {
  const job = [
    '  scan:',
    '    name: |',
    '      - name: Materialize AppGuardrail SARIF PR merge provenance',
    "        if: github.event_name == 'pull_request'",
    '        env:',
    '          PR_NUMBER: ${{ github.event.pull_request.number }}',
    '          EXPECTED_MERGE_SHA: ${{ github.sha }}',
    '        run: echo borrowed-provenance',
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        uses: github/codeql-action/upload-sarif@fake-sha',
    '    steps:',
    '      - name: Harmless real step',
    '        run: echo real-step',
  ].join('\n');

  assert.throws(
    () =>
      stepBlock(job, 'Materialize AppGuardrail SARIF PR merge provenance'),
    /expected exactly one step/u,
  );
  assert.equal(
    actionUses(job, 'github/codeql-action/upload-sarif').length,
    0,
    'action authority must come only from the direct steps sequence',
  );
});

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

test('SARIF upload authority rejects unnamed duplicate action uses', () => {
  const job = [
    '  scan:',
    '    steps:',
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        uses: github/codeql-action/upload-sarif@reviewed-sha',
    '        with:',
    `          ${SARIF_SOURCE_REF}`,
    `          ${SARIF_SOURCE_SHA}`,
    '      - uses: "github/codeql-action/upload-sarif@unreviewed-sha"',
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

test('SARIF upload authority rejects case-aliased duplicate action repository identity', () => {
  const job = [
    '  scan:',
    '    steps:',
    '      - name: Upload AppGuardrail SARIF to code scanning',
    '        uses: github/codeql-action/upload-sarif@reviewed-sha',
    '        with:',
    `          ${SARIF_SOURCE_REF}`,
    `          ${SARIF_SOURCE_SHA}`,
    '      - name: Upload case-aliased SARIF',
    '        uses: GitHub/CodeQL-Action/upload-sarif@unreviewed-sha',
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
    /expected exactly one github\/codeql-action\/upload-sarif use, found 2/u,
  );
});

test('workflow-step authority ignores name and uses text inside run blocks', () => {
  const job = [
    '  scan:',
    '    steps:',
    '      - name: Generate harmless evidence note',
    '        run: |',
    "          cat <<'EOF' > note.txt",
    '          - name: Upload AppGuardrail SARIF to code scanning',
    '            uses: github/codeql-action/upload-sarif@fake-sha',
    `            ${SARIF_SOURCE_REF}`,
    `            ${SARIF_SOURCE_SHA}`,
    '          EOF',
  ].join('\n');

  assert.throws(
    () =>
      assertUniqueActionUseInStep(
        job,
        'github/codeql-action/upload-sarif',
        'Upload AppGuardrail SARIF to code scanning',
      ),
    /expected exactly one github\/codeql-action\/upload-sarif use, found 0/u,
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