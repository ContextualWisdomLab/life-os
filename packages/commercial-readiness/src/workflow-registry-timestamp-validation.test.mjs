import assert from 'node:assert/strict';
import test from 'node:test';

import { collectWorkflowRegistrySnapshot } from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);
const TREE_SHA = 'a'.repeat(40);
const REPOSITORY = 'ContextualWisdomLab/life-os';

function inventoryClient() {
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
        return { sha: TREE_SHA, truncated: false, tree: [] };
      }
      if (path.endsWith('per_page=100&page=1')) {
        return { total_count: 0, workflows: [] };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

test('accepts the second-precision UTC timestamp emitted by the production workflow', async () => {
  const snapshot = await collectWorkflowRegistrySnapshot(
    inventoryClient(),
    REPOSITORY,
    SHA,
    { generatedAt: '2026-09-03T01:04:21Z' },
  );

  assert.equal(snapshot.generated_at, '2026-09-03T01:04:21.000Z');
});

test('still rejects offsets and non-canonical UTC timestamp evidence', async () => {
  for (const generatedAt of [
    '2026-09-03T10:04:21+09:00',
    '2026-09-03',
    '2026-02-30T01:04:21Z',
  ]) {
    await assert.rejects(
      collectWorkflowRegistrySnapshot(
        inventoryClient(),
        REPOSITORY,
        SHA,
        { generatedAt },
      ),
      /timestamp.*invalid/i,
    );
  }
});
