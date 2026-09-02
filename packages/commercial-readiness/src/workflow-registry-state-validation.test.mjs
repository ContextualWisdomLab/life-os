import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWorkflowRegistry } from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);
const WORKFLOW_PATH = '.github/workflows/ci.yml';

function workflow(state) {
  return {
    id: 1,
    name: 'CI',
    path: WORKFLOW_PATH,
    state,
  };
}

test('accepts every documented GitHub workflow state without changing active classification', () => {
  const active = classifyWorkflowRegistry({
    commitSha: SHA,
    treePaths: [WORKFLOW_PATH],
    workflows: [workflow('active')],
  });
  assert.deepEqual(active.present.map((entry) => entry.id), [1]);

  for (const state of [
    'deleted',
    'disabled_fork',
    'disabled_inactivity',
    'disabled_manually',
  ]) {
    const disabled = classifyWorkflowRegistry({
      commitSha: SHA,
      treePaths: [],
      workflows: [workflow(state)],
    });
    assert.deepEqual(disabled.disabled_orphans.map((entry) => entry.id), [1]);
  }
});

test('fails closed instead of treating an unknown workflow state as disabled evidence', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: SHA,
        treePaths: [],
        workflows: [workflow('suspended_by_policy')],
      }),
    /state.*invalid/i,
  );
});

test('fails closed when a workflow present in the protected tree is disabled in Actions', () => {
  for (const state of [
    'deleted',
    'disabled_fork',
    'disabled_inactivity',
    'disabled_manually',
  ]) {
    assert.throws(
      () =>
        classifyWorkflowRegistry({
          commitSha: SHA,
          treePaths: [WORKFLOW_PATH],
          workflows: [workflow(state)],
        }),
      /present workflow.*disabled/i,
    );
  }
});
