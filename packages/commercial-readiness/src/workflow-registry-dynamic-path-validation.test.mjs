import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWorkflowRegistry } from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);

function workflow(id, path) {
  return {
    id,
    name: `workflow-${id}`,
    path,
    state: 'active',
  };
}

test('fails closed when an undocumented non-repository workflow path masquerades as dynamic', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: SHA,
        treePaths: [],
        workflows: [workflow(1, 'retired/repair.yml')],
      }),
    /dynamic workflow path.*invalid/i,
  );
});

test('retains the documented GitHub Dependabot dynamic workflow namespace', () => {
  const snapshot = classifyWorkflowRegistry({
    commitSha: SHA,
    treePaths: [],
    workflows: [workflow(2, 'dynamic/dependabot/dependabot-updates')],
  });

  assert.deepEqual(snapshot.dynamic.map((entry) => entry.id), [2]);
  assert.equal(snapshot.active_orphans.length, 0);
});
