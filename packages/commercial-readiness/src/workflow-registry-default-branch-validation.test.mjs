import assert from 'node:assert/strict';
import test from 'node:test';

import { collectWorkflowRegistrySnapshot } from './workflow-registry.mjs';

const SHA = 'f'.repeat(40);
const MOVED_SHA = 'e'.repeat(40);
const TREE_SHA = 'a'.repeat(40);
const REPOSITORY = 'ContextualWisdomLab/life-os';

async function expectEncodedDefaultBranch(defaultBranch, encodedDefaultBranch) {
  const calls = [];
  const client = {
    async requestJson(path) {
      calls.push(path);
      if (path === `/repos/${REPOSITORY}`) return { default_branch: defaultBranch };
      if (path === `/repos/${REPOSITORY}/branches/${encodedDefaultBranch}`) {
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

  const snapshot = await collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA, {
    generatedAt: '2026-09-03T04:30:00Z',
  });

  assert.equal(snapshot.commit_sha, SHA);
  assert.equal(snapshot.workflow_count, 0);
  assert.equal(
    calls.filter((path) => path === `/repos/${REPOSITORY}/branches/${encodedDefaultBranch}`).length,
    2,
  );
}

test('accepts a valid percent-bearing default branch through an encoded branch API segment', async () => {
  await expectEncodedDefaultBranch('release%candidate', 'release%25candidate');
});

test('accepts a valid slash-bearing default branch through an encoded branch API segment', async () => {
  await expectEncodedDefaultBranch('release/candidate', 'release%2Fcandidate');
});

test('rejects a protected default-branch move after metadata revalidation', async () => {
  let metadataReads = 0;
  let branchReads = 0;
  const client = {
    async requestJson(path) {
      if (path === `/repos/${REPOSITORY}`) {
        metadataReads += 1;
        return { default_branch: 'main' };
      }
      if (path === `/repos/${REPOSITORY}/branches/main`) {
        branchReads += 1;
        return { commit: { sha: branchReads < 3 ? SHA : MOVED_SHA } };
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
    collectWorkflowRegistrySnapshot(client, REPOSITORY, SHA, {
      generatedAt: '2026-09-03T05:00:00Z',
    }),
    /Protected default branch moved during workflow inventory/u,
  );
  assert.equal(metadataReads, 2);
  assert.equal(branchReads, 3);
});
