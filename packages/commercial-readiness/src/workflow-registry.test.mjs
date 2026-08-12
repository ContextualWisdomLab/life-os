import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWorkflowRegistry,
  collectWorkflowRegistrySnapshot,
} from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);

function workflow(id, path, state = 'active', name = `workflow-${id}`) {
  return { id, name, path, state };
}

test('classifies repository workflows by exact path without trusting names', () => {
  const snapshot = classifyWorkflowRegistry({
    commitSha: SHA,
    treePaths: [
      '.github/workflows/ci.yml',
      '.github/workflows/live-repair.yml',
    ],
    workflows: [
      workflow(1, '.github/workflows/ci.yml', 'active', 'Repair-looking production name'),
      workflow(2, '.github/workflows/deleted-repair.yml', 'active', 'CI'),
      workflow(3, '.github/workflows/old.yml', 'disabled_manually'),
      workflow(4, 'dynamic/dependabot/dependabot-updates', 'active'),
      workflow(5, '.github/workflows/CI.yml', 'active', 'case-confusion'),
    ],
  });

  assert.equal(snapshot.schema, 'life-os.workflow-registry-snapshot.v1');
  assert.equal(snapshot.commit_sha, SHA);
  assert.deepEqual(snapshot.present.map((entry) => entry.id), [1]);
  assert.deepEqual(snapshot.active_orphans.map((entry) => entry.id), [2, 5]);
  assert.deepEqual(snapshot.disabled_orphans.map((entry) => entry.id), [3]);
  assert.deepEqual(snapshot.dynamic.map((entry) => entry.id), [4]);
});

test('rejects ambiguous workflow identities and unsafe repository paths', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: SHA,
        treePaths: ['.github/workflows/ci.yml'],
        workflows: [
          workflow(7, '.github/workflows/ci.yml'),
          workflow(7, '.github/workflows/renamed.yml'),
        ],
      }),
    /identity/i,
  );

  for (const path of [
    '.github/workflows/%2e%2e.yml',
    '.github/workflows/../ci.yml',
    '.github\\workflows\\ci.yml',
  ]) {
    assert.throws(
      () => classifyWorkflowRegistry({ commitSha: SHA, treePaths: [], workflows: [workflow(9, path)] }),
      /path/i,
    );
  }
});

test('paginates the complete registry and binds evidence to an unchanged default-branch head', async () => {
  const calls = [];
  const client = {
    async requestJson(path) {
      calls.push(path);
      if (path === '/repos/ContextualWisdomLab/life-os') return { default_branch: 'main' };
      if (path === '/repos/ContextualWisdomLab/life-os/branches/main') {
        return { commit: { sha: SHA } };
      }
      if (path === `/repos/ContextualWisdomLab/life-os/git/trees/${SHA}?recursive=1`) {
        return {
          truncated: false,
          tree: [{ type: 'blob', path: '.github/workflows/ci.yml' }],
        };
      }
      if (path.endsWith('per_page=100&page=1')) {
        return { total_count: 101, workflows: Array.from({ length: 100 }, (_, index) => workflow(index + 1, `.github/workflows/deleted-${index + 1}.yml`)) };
      }
      if (path.endsWith('per_page=100&page=2')) {
        return { total_count: 101, workflows: [workflow(101, '.github/workflows/ci.yml')] };
      }
      throw new Error(`unexpected ${path}`);
    },
  };

  const result = await collectWorkflowRegistrySnapshot(
    client,
    'ContextualWisdomLab/life-os',
    SHA,
  );

  assert.equal(result.workflow_count, 101);
  assert.equal(result.active_orphans.length, 100);
  assert.deepEqual(result.present.map((entry) => entry.id), [101]);
  assert.equal(calls.filter((path) => path.includes('/actions/workflows?')).length, 2);
  assert.equal(calls.at(-1), '/repos/ContextualWisdomLab/life-os/branches/main');
});

test('fails closed on pagination truncation, tree truncation, and branch movement', async () => {
  const baseClient = {
    async requestJson(path) {
      if (path === '/repos/ContextualWisdomLab/life-os') return { default_branch: 'main' };
      if (path === '/repos/ContextualWisdomLab/life-os/branches/main') return { commit: { sha: SHA } };
      if (path.startsWith(`/repos/ContextualWisdomLab/life-os/git/trees/${SHA}`)) return { truncated: true, tree: [] };
      throw new Error(`unexpected ${path}`);
    },
  };
  await assert.rejects(
    collectWorkflowRegistrySnapshot(baseClient, 'ContextualWisdomLab/life-os', SHA),
    /tree.*truncated/i,
  );

  let branchReads = 0;
  const movedClient = {
    async requestJson(path) {
      if (path === '/repos/ContextualWisdomLab/life-os') return { default_branch: 'main' };
      if (path === '/repos/ContextualWisdomLab/life-os/branches/main') {
        branchReads += 1;
        return { commit: { sha: branchReads === 1 ? SHA : 'e'.repeat(40) } };
      }
      if (path.startsWith(`/repos/ContextualWisdomLab/life-os/git/trees/${SHA}`)) {
        return { truncated: false, tree: [] };
      }
      if (path.endsWith('per_page=100&page=1')) return { total_count: 0, workflows: [] };
      throw new Error(`unexpected ${path}`);
    },
  };
  await assert.rejects(
    collectWorkflowRegistrySnapshot(movedClient, 'ContextualWisdomLab/life-os', SHA),
    /moved/i,
  );
}