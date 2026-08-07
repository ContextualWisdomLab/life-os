import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-nim-maintenance.yml',
);
const REVIEW_WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/appguardrail.yml',
);
const FINGERPRINT_PATH = resolve(
  import.meta.dirname,
  '../../../product/review-agent-integrity.json',
);
const workflow = await readFile(WORKFLOW_PATH, 'utf8');
const reviewWorkflow = await readFile(REVIEW_WORKFLOW_PATH, 'utf8');
const fingerprint = JSON.parse(await readFile(FINGERPRINT_PATH, 'utf8'));

function step(name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  assert.ok(start >= 0, `missing workflow step: ${name}`);
  const next = workflow.indexOf('\n      - name: ', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

describe('NVIDIA OpenCode maintenance workflow contract', () => {
  it('runs hourly and manually from reviewed default-branch source', () => {
    assert.match(workflow, /- cron: '37 \* \* \* \*'/u);
    assert.match(workflow, /^  workflow_dispatch:$/mu);
    assert.match(
      workflow,
      /github\.event_name == 'schedule' \|\| github\.ref_name == github\.event\.repository\.default_branch/u,
    );
    assert.match(workflow, /cancel-in-progress: false/u);
    assert.match(workflow, /timeout-minutes: 170/u);
  });

  it('pins every external action and the OpenCode GitHub action', () => {
    const actions = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(
      (match) => match[1],
    );
    assert.ok(actions.length >= 6);
    for (const action of actions) {
      assert.match(action, /^[^@\s]+@[0-9a-f]{40}$/u);
    }
    assert.match(
      workflow,
      /anomalyco\/opencode\/github@77fc88c8ade8e5a620ebbe1197f3a572d29ae91a/u,
    );
  });

  it('uses NVIDIA NIM and contains no Copilot credential path', () => {
    const prohibited = ['COPILOT', 'GITHUB', 'TOKEN'].join('_');
    assert.equal(workflow.includes(prohibited), false);
    assert.match(
      workflow,
      /model: nvidia\/nvidia\/llama-3\.3-nemotron-super-49b-v1\.5/u,
    );
    assert.equal(
      (workflow.match(/secrets\.NVIDIA_NIM_API_KEY/gu) ?? []).length,
      2,
    );
    assert.equal(
      workflow.includes('CODERABBIT_API_KEY') ||
        workflow.includes('STRIX_API_KEY') ||
        workflow.includes('OPENCODE_REVIEW_TOKEN'),
      false,
    );
  });

  it('keeps model execution read-only and delegates no merge or release authority', () => {
    assert.match(workflow, /^permissions:\n  contents: read$/mu);
    assert.equal(workflow.includes('contents: write'), false);
    assert.equal(workflow.includes('pull-requests: write'), false);
    assert.equal(workflow.includes('issues: write'), false);
    const model = step('Run the plan-only OpenCode maintenance agent');
    assert.match(model, /agent: maintenance-planner/u);
    assert.match(model, /share: 'false'/u);
    assert.match(model, /Do not modify source/u);
    assert.match(model, /mutate GitHub/u);
    assert.equal(/\b(?:gh pr merge|git push|git tag)\b/u.test(model), false);
  });

  it('compiles reviewed evidence before exposing the model credential', () => {
    assert.ok(
      workflow.indexOf('Compile the reviewed maintenance contract') <
        workflow.indexOf('Require the dedicated NVIDIA NIM credential'),
    );
    assert.ok(
      workflow.indexOf('Require the dedicated NVIDIA NIM credential') <
        workflow.indexOf('Run the plan-only OpenCode maintenance agent'),
    );
    assert.match(
      step('Compile the reviewed maintenance contract'),
      /product\/review-agent-integrity\.json/u,
    );
  });

  it('fails closed for high-risk conducted work until the reviewed orchestrator path is available', () => {
    const fallback = step(
      'Produce explicit no-model evidence when planning is not authorized',
    );
    assert.match(fallback, /conduct_bounded/u);
    assert.match(fallback, /orchestrator_unavailable/u);
    assert.match(fallback, /exact-pinned contextual-orchestrator/u);
    assert.equal(
      step('Run the plan-only OpenCode maintenance agent').includes(
        'conduct_bounded',
      ),
      false,
    );
  });

  it('retains only validated contract and plan artifacts', () => {
    const upload = step('Upload only validated credential-free plan evidence');
    assert.match(upload, /maintenance-contract\.json/u);
    assert.match(upload, /maintenance-plan\.json/u);
    assert.match(upload, /maintenance-plan\.md/u);
    assert.match(upload, /if-no-files-found: error/u);
    assert.equal(upload.includes('.maintenance-output'), false);
    assert.equal(upload.includes('opencode.log'), false);
    assert.equal(upload.includes('contextual-orchestrator.log'), false);
  });

  it('does not alter the independent AppGuardrail review boundary', () => {
    assert.deepEqual(fingerprint.workflowPaths, [
      '.github/workflows/appguardrail.yml',
    ]);
    assert.deepEqual(fingerprint.secretNames, []);
    assert.match(fingerprint.digest, /^[0-9a-f]{64}$/u);
    assert.match(reviewWorkflow, /^name: AppGuardrail$/mu);
    assert.equal(workflow.includes('appguardrail.yml'), false);
  });
});
