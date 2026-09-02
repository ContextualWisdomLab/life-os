import assert from 'node:assert/strict';
import test from 'node:test';

import { collectWorkflowRegistrySnapshot } from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);
const TREE_SHA = 'a'.repeat(40);
const REPOSITORY = 'ContextualWisdomLab/life-os';
const WORKFLOW_PATH = '.github/workflows/ci.yml';

function clientWithWorkflowTreeMode(mode, type = 'blob', workflowPath = WORKFLOW_PATH) {
  return {
    async requestJson(path) {
      if (path === `/repos/${REPOSITORY}`) return { default_branch: 'main' };
      if (path === `/repos/${REPOSITORY}/branches/main`) {
        return { commit: { sha: SHA } };
      }
      if (path === `/repos/${REPOSITORY}/git/commits/${SHA}`) {
        return { sha: SHA, tree: { sha: TREE_SHA } };
      }
      if (path === `/repos/${REPOSITORY}/git/trees/${TREE_SHA}?recursive=1`) {
        return {
          sha: TREE_SHA,
          truncated: false,
          tree: [
            {
              path: workflowPath,
              mode,
              type,
              sha: 'b'.repeat(40),
            },
          ],
        };
      }
      if (path.endsWith('per_page=100&page=1')) {
        return {
          total_count: 1,
          workflows: [
            {
              id: 1,
              name: 'CI',
              path: workflowPath,
              state: 'active',
            },
          ],
        };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

function clientWithUnrelatedWorkflowDirectoryEntry() {
  const stable = clientWithWorkflowTreeMode('100644');
  return {
    async requestJson(path) {
      if (path === `/repos/${REPOSITORY}/git/trees/${TREE_SHA}?recursive=1`) {
        return {
          sha: TREE_SHA,
          truncated: false,
          tree: [
            {
              path: WORKFLOW_PATH,
              mode: '100644',
              type: 'blob',
              sha: 'b'.repeat(40),
            },
            {
              path: '.github/workflows/README.md',
              mode: '100644',
              type: 'blob',
              sha: 'c'.repeat(40),
            },
          ],
        };
      }
      return stable.requestJson(path);
    },
  };
}

test('fails closed when a workflow-shaped Git tree entry is a symlink blob', async () => {
  await assert.rejects(
    collectWorkflowRegistrySnapshot(
      clientWithWorkflowTreeMode('120000'),
      REPOSITORY,
      SHA,
    ),
    /workflow tree entry mode.*invalid/i,
  );
});

test('fails closed when a workflow-shaped Git tree entry is not a blob', async () => {
  await assert.rejects(
    collectWorkflowRegistrySnapshot(
      clientWithWorkflowTreeMode('160000', 'commit'),
      REPOSITORY,
      SHA,
    ),
    /workflow tree entry.*invalid/i,
  );
});

test('ignores unrelated non-workflow files inside the workflow directory', async () => {
  const snapshot = await collectWorkflowRegistrySnapshot(
    clientWithUnrelatedWorkflowDirectoryEntry(),
    REPOSITORY,
    SHA,
  );

  assert.deepEqual(snapshot.present.map((entry) => entry.id), [1]);
  assert.equal(snapshot.active_orphans.length, 0);
});

test('keeps line-separator workflow paths bound to the protected tree', async () => {
  const workflowPath = '.github/workflows/line\u2028separator.yml';
  const snapshot = await collectWorkflowRegistrySnapshot(
    clientWithWorkflowTreeMode('100644', 'blob', workflowPath),
    REPOSITORY,
    SHA,
  );

  assert.deepEqual(snapshot.present.map((entry) => entry.id), [1]);
  assert.equal(snapshot.active_orphans.length, 0);
});
