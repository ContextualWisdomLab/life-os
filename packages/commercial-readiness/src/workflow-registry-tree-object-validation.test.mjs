import assert from 'node:assert/strict';
import test from 'node:test';

import { collectWorkflowRegistrySnapshot } from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);
const TREE_SHA = 'a'.repeat(40);
const REPOSITORY = 'ContextualWisdomLab/life-os';
const WORKFLOW_PATH = '.github/workflows/ci.yml';

function inventoryClient(workflowBlobSha) {
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
              mode: '100644',
              type: 'blob',
              ...(workflowBlobSha === undefined ? {} : { sha: workflowBlobSha }),
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

for (const [name, workflowBlobSha] of [
  ['missing', undefined],
  ['malformed', 'not-a-git-object-id'],
]) {
  test(`fails closed when protected workflow tree evidence has a ${name} blob SHA`, async () => {
    await assert.rejects(
      collectWorkflowRegistrySnapshot(
        inventoryClient(workflowBlobSha),
        REPOSITORY,
        SHA,
      ),
      /workflow tree entry blob sha is invalid/i,
    );
  });
}
