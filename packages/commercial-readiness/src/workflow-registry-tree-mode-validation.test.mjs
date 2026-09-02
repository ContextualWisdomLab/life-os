import assert from 'node:assert/strict';
import test from 'node:test';

import { collectWorkflowRegistrySnapshot } from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);
const TREE_SHA = 'a'.repeat(40);
const REPOSITORY = 'ContextualWisdomLab/life-os';
const WORKFLOW_PATH = '.github/workflows/ci.yml';

function clientWithWorkflowTreeMode(mode) {
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
              path: WORKFLOW_PATH,
              mode,
              type: 'blob',
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
              path: WORKFLOW_PATH,
              state: 'active',
            },
          ],
        };
      }
      throw new Error(`unexpected ${path}`);
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
