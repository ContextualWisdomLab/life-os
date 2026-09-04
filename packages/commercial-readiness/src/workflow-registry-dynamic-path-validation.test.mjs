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

test('fails closed when an undocumented workflow path uses the dynamic namespace', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: SHA,
        treePaths: [],
        workflows: [workflow(2, 'dynamic/unknown/repair')],
      }),
    /dynamic workflow path.*invalid/i,
  );
});

test('retains the documented GitHub Dependabot dynamic workflow identity', () => {
  const snapshot = classifyWorkflowRegistry({
    commitSha: SHA,
    treePaths: [],
    workflows: [workflow(3, 'dynamic/dependabot/dependabot-updates')],
  });

  assert.deepEqual(snapshot.dynamic.map((entry) => entry.id), [3]);
  assert.equal(snapshot.active_orphans.length, 0);
});

test('fails closed when multiple workflow identities claim the documented dynamic path', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: SHA,
        treePaths: [],
        workflows: [
          workflow(4, 'dynamic/dependabot/dependabot-updates'),
          workflow(5, 'dynamic/dependabot/dependabot-updates'),
        ],
      }),
    /dynamic workflow path identity.*ambiguous/i,
  );
});
