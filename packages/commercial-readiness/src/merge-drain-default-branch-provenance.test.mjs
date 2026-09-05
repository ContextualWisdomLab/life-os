import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import * as githubClientModule from './github-client.mjs';

const repository = 'ContextualWisdomLab/life-os';
const expectedHead = 'a'.repeat(40);
const advancedHead = 'b'.repeat(40);

describe('merge-drain protected-default-branch provenance', () => {
  it('requires an unchanged protected default branch immediately before merge mutation', async () => {
    assert.equal(
      typeof githubClientModule.assertDefaultBranchHead,
      'function',
      'merge drain must expose exact protected-default-branch validation',
    );

    const requests = [];
    const movedClient = {
      async requestJson(path) {
        requests.push(path);
        return { commit: { sha: advancedHead } };
      },
    };

    await assert.rejects(
      () =>
        githubClientModule.assertDefaultBranchHead(
          movedClient,
          repository,
          'main',
          expectedHead,
        ),
      /Protected default branch changed during merge drain/,
    );
    assert.deepEqual(requests, [
      '/repos/ContextualWisdomLab/life-os/branches/main',
    ]);

    const exactClient = {
      async requestJson() {
        return { commit: { sha: expectedHead.toUpperCase() } };
      },
    };
    await githubClientModule.assertDefaultBranchHead(
      exactClient,
      repository,
      'main',
      expectedHead,
    );

    const source = await readFile(new URL('./cli.mjs', import.meta.url), 'utf8');
    const commandStart = source.indexOf('async function commandDrain');
    const commandEnd = source.indexOf('\nasync function main', commandStart);
    assert.ok(commandStart >= 0 && commandEnd > commandStart);
    const commandDrain = source.slice(commandStart, commandEnd);
    const mergeCallback = commandDrain.indexOf('mergePullRequest: async');
    const exactHeadCheck = commandDrain.indexOf(
      'await assertDefaultBranchHead(',
      mergeCallback,
    );
    const mergeMutation = commandDrain.indexOf(
      'mergePullRequestThroughApi(',
      mergeCallback,
    );
    assert.ok(
      mergeCallback >= 0 &&
        exactHeadCheck > mergeCallback &&
        mergeMutation > exactHeadCheck,
      'commandDrain must revalidate the protected default branch immediately before the merge API mutation',
    );
  });
});
