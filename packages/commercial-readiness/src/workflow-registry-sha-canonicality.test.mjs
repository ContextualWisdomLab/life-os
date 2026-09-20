import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyWorkflowRegistry,
  collectWorkflowRegistrySnapshot,
} from './workflow-registry.mjs';

const SHA = 'a'.repeat(40);
const TREE_SHA = 'b'.repeat(40);
const REPOSITORY = 'ContextualWisdomLab/life-os';

test('rejects noncanonical uppercase expected commit evidence instead of recanonicalizing it', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: SHA.toUpperCase(),
        treePaths: [],
        workflows: [],
      }),
    /commit SHA.*invalid/i,
  );
});

test('rejects noncanonical uppercase protected-branch commit evidence', async () => {
  const client = {
    async requestJson(path) {
      if (path === `/repos/${REPOSITORY}`) return { default_branch: 'main' };
      if (path === `/repos/${REPOSITORY}/branches/main`) {
        return { commit: { sha: SHA.toUpperCase() } };
      }
      if (path === `/repos/${REPOSITORY}/git/commits/${SHA}`) {
        return { sha: SHA, tree: { sha: TREE_SHA } };
      }
      if (path === `/repos/${REPOSITORY}/git/trees/${TREE_SHA}?recursive=1`) {
        return { sha: TREE_SHA, truncated: false, tree: [] };
      }
      if (path.endsWith('per_page=100&page=1')) {
        return { total_count: 0, workflows: [] };
      }
      throw new Error(`unexpected ${path}`);
    },
  };

  await assert.rejects(
    collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA),
    /commit SHA.*invalid/i,
  );
});
