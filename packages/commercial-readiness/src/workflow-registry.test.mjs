import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWorkflowRegistry,
  collectWorkflowRegistrySnapshot,
} from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);
const TREE_SHA = 'a'.repeat(40);
const GENERATED_AT = '2026-08-12T12:00:00.000Z';
const REPOSITORY = 'ContextualWisdomLab/life-os';

function workflow(id, path, state = 'active', name = `workflow-${id}`) {
  return { id, name, path, state };
}

function inventoryClient(overrides = {}) {
  let branchReads = 0;
  return {
    async requestJson(path) {
      if (overrides[path]) return overrides[path](branchReads++);
      if (path === `/repos/${REPOSITORY}`) return { default_branch: 'main' };
      if (path === `/repos/${REPOSITORY}/branches/main`) return { commit: { sha: SHA } };
      if (path === `/repos/${REPOSITORY}/git/commits/${SHA}`) {
        return { sha: SHA, tree: { sha: TREE_SHA } };
      }
      if (path === `/repos/${REPOSITORY}/git/trees/${TREE_SHA}?recursive=1`) {
        return { sha: TREE_SHA, truncated: false, tree: [] };
      }
      if (path.endsWith('per_page=100&page=1')) return { total_count: 0, workflows: [] };
      throw new Error(`unexpected ${path}`);
    },
  };
}

test('classifies repository workflows by exact path without trusting names', () => {
  const snapshot = classifyWorkflowRegistry({
    commitSha: SHA,
    treePaths: [
      '.github/dependabot.yml',
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
      () =>
        classifyWorkflowRegistry({
          commitSha: SHA,
          treePaths: [],
          workflows: [workflow(9, path)],
        }),
      /path/i,
    );
  }
});

test('rejects relative repository and default-branch API path segments', async () => {
  const unexpectedClient = {
    async requestJson(path) {
      throw new Error(`unexpected request ${path}`);
    },
  };
  for (const repository of [
    './life-os',
    '../life-os',
    'ContextualWisdomLab/.',
    'ContextualWisdomLab/..',
  ]) {
    await assert.rejects(
      collectWorkflowRegistrySnapshot(unexpectedClient, repository, SHA),
      /repository.*invalid/i,
    );
  }

  for (const defaultBranch of ['.', '..', 'feature/unsafe']) {
    const client = {
      async requestJson(path) {
        if (path === `/repos/${REPOSITORY}`) return { default_branch: defaultBranch };
        throw new Error(`unexpected request ${path}`);
      },
    };
    await assert.rejects(
      collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA),
      /default branch.*invalid/i,
    );
  }
});

test('paginates the complete registry and binds receipts to an unchanged default-branch tree', async () => {
  const calls = [];
  const client = {
    async requestJson(path) {
      calls.push(path);
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
            { type: 'blob', path: '.github/dependabot.yml' },
            { type: 'blob', mode: '100644', path: '.github/workflows/ci.yml' },
          ],
        };
      }
      if (path.endsWith('per_page=100&page=1')) {
        return {
          total_count: 101,
          workflows: Array.from({ length: 100 }, (_, index) =>
            workflow(index + 1, `.github/workflows/deleted-${index + 1}.yml`),
          ),
        };
      }
      if (path.endsWith('per_page=100&page=2')) {
        return { total_count: 101, workflows: [workflow(101, '.github/workflows/ci.yml')] };
      }
      throw new Error(`unexpected ${path}`);
    },
  };

  const result = await collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA, {
    generatedAt: GENERATED_AT,
  });

  assert.equal(result.commit_sha, SHA);
  assert.equal(result.tree_sha, TREE_SHA);
  assert.equal(result.generated_at, GENERATED_AT);
  assert.deepEqual(result.registry_receipt, { pages: 2, total_count: 101 });
  assert.equal(result.workflow_count, 101);
  assert.equal(result.active_orphans.length, 100);
  assert.deepEqual(result.present.map((entry) => entry.id), [101]);
  assert.equal(calls.filter((path) => path.includes('/actions/workflows?')).length, 4);
  assert.deepEqual(calls.slice(-2), [
    `/repos/${REPOSITORY}/branches/main`,
    `/repos/${REPOSITORY}`,
  ]);
});

test('fails closed on incomplete or inconsistent workflow pagination', async () => {
  const cases = [
    {
      name: 'pagination truncation',
      error: /pagination.*truncated/i,
      pages: [
        {
          total_count: 101,
          workflows: Array.from({ length: 99 }, (_, index) =>
            workflow(index + 1, `.github/workflows/${index + 1}.yml`),
          ),
        },
      ],
    },
    {
      name: 'pagination inconsistency',
      error: /pagination.*inconsistent/i,
      pages: [
        {
          total_count: 1,
          workflows: [
            workflow(1, '.github/workflows/a.yml'),
            workflow(2, '.github/workflows/b.yml'),
          ],
        },
      ],
    },
    {
      name: 'changing total_count',
      error: /changed during pagination/i,
      pages: [
        {
          total_count: 101,
          workflows: Array.from({ length: 100 }, (_, index) =>
            workflow(index + 1, `.github/workflows/${index + 1}.yml`),
          ),
        },
        { total_count: 102, workflows: [workflow(101, '.github/workflows/101.yml')] },
      ],
    },
    {
      name: 'malformed response',
      error: /response.*invalid/i,
      pages: [{ total_count: '1', workflows: [] }],
    },
  ];

  for (const scenario of cases) {
    let page = 0;
    const client = inventoryClient({
      [`/repos/${REPOSITORY}/actions/workflows?per_page=100&page=1`]: () =>
        scenario.pages[page++],
      [`/repos/${REPOSITORY}/actions/workflows?per_page=100&page=2`]: () =>
        scenario.pages[page++],
    });
    await assert.rejects(
      collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA),
      scenario.error,
      scenario.name,
    );
  }

  const pageLimitClient = {
    async requestJson(path) {
      if (path === `/repos/${REPOSITORY}`) return { default_branch: 'main' };
      if (path === `/repos/${REPOSITORY}/branches/main`) return { commit: { sha: SHA } };
      if (path === `/repos/${REPOSITORY}/git/commits/${SHA}`) {
        return { sha: SHA, tree: { sha: TREE_SHA } };
      }
      if (path === `/repos/${REPOSITORY}/git/trees/${TREE_SHA}?recursive=1`) {
        return { sha: TREE_SHA, truncated: false, tree: [] };
      }
      if (path.includes('/actions/workflows?')) {
        return {
          total_count: 1001,
          workflows: Array.from({ length: 100 }, (_, index) =>
            workflow(index + 1, `.github/workflows/page-${path.at(-1)}-${index}.yml`),
          ),
        };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
  await assert.rejects(
    collectWorkflowRegistrySnapshot(pageLimitClient, REPOSITORY, SHA),
    /exceeded the page limit/i,
  );
});

test('fails closed on tree, commit, branch, timestamp, and client evidence defects', async () => {
  const treeTruncatedClient = inventoryClient({
    [`/repos/${REPOSITORY}/git/trees/${TREE_SHA}?recursive=1`]: () => ({
      sha: TREE_SHA,
      truncated: true,
      tree: [],
    }),
  });
  await assert.rejects(
    collectWorkflowRegistrySnapshot(treeTruncatedClient, REPOSITORY, SHA),
    /tree.*truncated/i,
  );

  const mismatchedCommitClient = inventoryClient({
    [`/repos/${REPOSITORY}/git/commits/${SHA}`]: () => ({
      sha: 'e'.repeat(40),
      tree: { sha: TREE_SHA },
    }),
  });
  await assert.rejects(
    collectWorkflowRegistrySnapshot(mismatchedCommitClient, REPOSITORY, SHA),
    /commit evidence.*inconsistent/i,
  );

  const movedBeforeClient = inventoryClient({
    [`/repos/${REPOSITORY}/branches/main`]: () => ({ commit: { sha: 'e'.repeat(40) } }),
  });
  await assert.rejects(
    collectWorkflowRegistrySnapshot(movedBeforeClient, REPOSITORY, SHA),
    /moved before/i,
  );

  let branchReads = 0;
  const movedDuringClient = {
    async requestJson(path) {
      if (path === `/repos/${REPOSITORY}`) return { default_branch: 'main' };
      if (path === `/repos/${REPOSITORY}/branches/main`) {
        branchReads += 1;
        return { commit: { sha: branchReads === 1 ? SHA : 'e'.repeat(40) } };
      }
      if (path === `/repos/${REPOSITORY}/git/commits/${SHA}`) {
        return { sha: SHA, tree: { sha: TREE_SHA } };
      }
      if (path === `/repos/${REPOSITORY}/git/trees/${TREE_SHA}?recursive=1`) {
        return { sha: TREE_SHA, truncated: false, tree: [] };
      }
      if (path.endsWith('per_page=100&page=1')) return { total_count: 0, workflows: [] };
      throw new Error(`unexpected ${path}`);
    },
  };
  await assert.rejects(
    collectWorkflowRegistrySnapshot(movedDuringClient, REPOSITORY, SHA),
    /moved during/i,
  );

  await assert.rejects(
    collectWorkflowRegistrySnapshot(inventoryClient(), REPOSITORY, SHA, {
      generatedAt: 'not-an-iso-timestamp',
    }),
    /timestamp.*invalid/i,
  );
  await assert.rejects(
    collectWorkflowRegistrySnapshot({}, REPOSITORY, SHA),
    /client.*invalid/i,
  );
});
