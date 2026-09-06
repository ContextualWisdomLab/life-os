import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDrainPullRequestSelector } from './cli.mjs';

function pullRequest(number, eligible) {
  return { number, eligible };
}

describe('merge drain mutation authority', () => {
  it('pins one eligible merge candidate for the lifetime of one mutating drain run', () => {
    const select = createDrainPullRequestSelector(true);
    const firstSnapshot = [
      pullRequest(300, false),
      pullRequest(301, true),
      pullRequest(302, true),
    ];

    assert.deepEqual(select(firstSnapshot), [pullRequest(301, true)]);

    const refreshedSnapshot = [
      pullRequest(299, true),
      pullRequest(301, true),
      pullRequest(302, true),
    ];
    assert.deepEqual(
      select(refreshedSnapshot),
      [pullRequest(301, true)],
      'newly eligible or earlier PRs must wait for a fresh default-branch run',
    );

    assert.deepEqual(
      select([pullRequest(302, true)]),
      [],
      'the selector must not substitute a different PR if the pinned candidate disappears',
    );
  });

  it('preserves the complete candidate set for dry-run evidence', () => {
    const select = createDrainPullRequestSelector(false);
    const snapshot = [pullRequest(300, false), pullRequest(301, true)];
    assert.equal(select(snapshot), snapshot);
  });

  it('rejects malformed candidate collections', () => {
    const select = createDrainPullRequestSelector(true);
    assert.throws(() => select(null), /Pull request snapshot is invalid/);
  });
});
