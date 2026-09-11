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

  it('fails closed when a mutating snapshot repeats one pull-request identity', () => {
    const initial = createDrainPullRequestSelector(true);
    assert.throws(
      () => initial([pullRequest(301, true), pullRequest(301, true)]),
      /duplicate pull request identity/,
      'duplicate initial evidence must fail before any mutation candidate is returned',
    );

    const refreshed = createDrainPullRequestSelector(true);
    assert.deepEqual(refreshed([pullRequest(301, true)]), [
      pullRequest(301, true),
    ]);
    assert.throws(
      () => refreshed([pullRequest(301, true), pullRequest(301, true)]),
      /duplicate pull request identity/,
      'duplicate refreshed evidence must fail before the pinned candidate can be mutated',
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