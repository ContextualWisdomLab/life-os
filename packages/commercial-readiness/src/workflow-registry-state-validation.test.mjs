import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWorkflowRegistry,
  collectWorkflowRegistrySnapshot,
} from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);
const TREE_SHA = 'a'.repeat(40);
const OTHER_TREE_SHA = 'b'.repeat(40);
const REPOSITORY = 'ContextualWisdomLab/life-os';
const WORKFLOW_PATH = '.github/workflows/ci.yml';

function workflow(state) {
  return {
    id: 1,
    name: 'CI',
    path: WORKFLOW_PATH,
    state,
  };
}

function dynamicWorkflow(id) {
  return {
    id,
    name: `Dynamic workflow ${id}`,
    path: `dynamic/workflow-${id}`,
    state: 'active',
  };
}

function inventoryClient(treeResponseSha = TREE_SHA) {
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
        return { sha: treeResponseSha, truncated: false, tree: [] };
      }
      if (path.endsWith('per_page=100&page=1')) {
        return { total_count: 0, workflows: [] };
      }
      throw new Error(`unexpected ${path}`);
    },
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

test('fails closed when a protected-tree workflow is absent from the Actions registry', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: SHA,
        treePaths: [WORKFLOW_PATH],
        workflows: [],
      }),
    /protected-tree workflow.*missing.*registry/i,
  );
});

test('fails closed when multiple workflow identities claim one repository path', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: SHA,
        treePaths: [WORKFLOW_PATH],
        workflows: [
          workflow('active'),
          {
            id: 2,
            name: 'CI replacement',
            path: WORKFLOW_PATH,
            state: 'active',
          },
        ],
      }),
    /repository path.*ambiguous/i,
  );
});

test('fails closed when the recursive tree response is not the commit tree', async () => {
  await assert.rejects(
    collectWorkflowRegistrySnapshot(
      inventoryClient(OTHER_TREE_SHA),
      REPOSITORY,
      SHA,
    ),
    /tree evidence.*inconsistent/i,
  );
});

test('fails closed when the workflow registry changes across pagination without changing total count', async () => {
  const stable = inventoryClient();
  let registryPass = 0;
  const client = {
    async requestJson(path) {
      if (path.endsWith('per_page=100&page=1')) {
        registryPass += 1;
        const startId = registryPass === 1 ? 1 : 2;
        return {
          total_count: 101,
          workflows: Array.from({ length: 100 }, (_, index) =>
            dynamicWorkflow(startId + index),
          ),
        };
      }
      if (path.endsWith('per_page=100&page=2')) {
        return { total_count: 101, workflows: [dynamicWorkflow(102)] };
      }
      return stable.requestJson(path);
    },
  };

  await assert.rejects(
    collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA),
    /workflow registry changed during inventory/i,
  );
  assert.equal(registryPass, 2);
});

test('fails closed when the repository default branch changes during inventory', async () => {
  const stable = inventoryClient();
  let metadataReads = 0;
  const client = {
    async requestJson(path) {
      if (path === `/repos/${REPOSITORY}`) {
        metadataReads += 1;
        return { default_branch: metadataReads === 1 ? 'main' : 'develop' };
      }
      return stable.requestJson(path);
    },
  };

  await assert.rejects(
    collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA),
    /default branch.*changed.*inventory/i,
  );
  assert.equal(metadataReads, 2);
});

test('fails closed when the default branch changes after the last metadata read', async () => {
  const stable = inventoryClient();
  let defaultBranch = 'main';
  let branchReads = 0;
  const client = {
    async requestJson(path) {
      if (path === `/repos/${REPOSITORY}`) {
        return { default_branch: defaultBranch };
      }
      if (path === `/repos/${REPOSITORY}/branches/main`) {
        branchReads += 1;
        const response = { commit: { sha: SHA } };
        if (branchReads === 2) defaultBranch = 'develop';
        return response;
      }
      return stable.requestJson(path);
    },
  };

  await assert.rejects(
    collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA),
    /default branch.*changed.*inventory/i,
  );
  assert.equal(branchReads, 2);
});
