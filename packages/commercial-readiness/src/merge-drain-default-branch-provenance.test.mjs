import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import * as cliModule from './cli.mjs';

const repository = 'ContextualWisdomLab/life-os';
const expectedHead = 'a'.repeat(40);
const advancedHead = 'b'.repeat(40);

describe('merge-drain protected-default-branch provenance', () => {
  it('fails closed on malformed authority inputs and live branch evidence', async () => {
    assert.equal(
      typeof cliModule.assertDefaultBranchHead,
      'function',
      'merge drain must expose exact protected-default-branch validation',
    );

    const validClient = {
      async requestJson() {
        return { commit: { sha: expectedHead } };
      },
    };
    const invalidInputs = [
      [null, repository, 'main', expectedHead],
      [{}, repository, 'main', expectedHead],
      [validClient, null, 'main', expectedHead],
      [validClient, 'ContextualWisdomLab/life-os/extra', 'main', expectedHead],
      [validClient, repository, null, expectedHead],
      [validClient, repository, '', expectedHead],
      [validClient, repository, 'm'.repeat(256), expectedHead],
      [validClient, repository, 'main\\escape', expectedHead],
      [validClient, repository, 'main', null],
      [validClient, repository, 'main', 'not-a-sha'],
    ];
    for (const args of invalidInputs) {
      await assert.rejects(
        () => cliModule.assertDefaultBranchHead(...args),
        /Merge drain default-branch evidence is invalid/,
      );
    }

    const malformedLiveClient = {
      async requestJson() {
        return { commit: { sha: 'not-a-sha' } };
      },
    };
    await assert.rejects(
      () =>
        cliModule.assertDefaultBranchHead(
          malformedLiveClient,
          repository,
          'main',
          expectedHead,
        ),
      /Protected default branch changed during merge drain/,
    );
  });

  it('requires an unchanged protected default branch immediately before merge mutation', async () => {
    const requests = [];
    const movedClient = {
      async requestJson(path) {
        requests.push(path);
        return { commit: { sha: advancedHead } };
      },
    };

    await assert.rejects(
      () =>
        cliModule.assertDefaultBranchHead(
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
    await cliModule.assertDefaultBranchHead(
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
