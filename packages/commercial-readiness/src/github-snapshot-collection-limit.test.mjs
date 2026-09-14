import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateGitHubSnapshot } from './schema.mjs';

const repository = 'ContextualWisdomLab/life-os';
const headSha = 'a'.repeat(40);

function issue(number) {
  return {
    number,
    title: `Issue ${number}`,
    state: 'open',
    labels: [],
  };
}

function review(index) {
  return {
    actor: `reviewer-${index}`,
    state: 'COMMENTED',
    submitted_at: '2026-09-14T00:00:00Z',
    commit_id: headSha,
  };
}

function pullRequest(number, reviews = []) {
  return {
    number,
    title: `Pull request ${number}`,
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    base_ref: 'main',
    head_sha: headSha,
    head_repo: repository,
    repository,
    author_association: 'OWNER',
    behind_by: 0,
    reviews,
    unresolved_threads: 0,
    workflows: [],
    statuses: [],
    eligible: false,
    blockers: ['missing-approval'],
  };
}

function snapshot(overrides = {}) {
  return {
    schema: 'life-os.github-snapshot.v1',
    repository,
    commit_sha: headSha,
    generated_at: '2026-09-14T00:00:00.000Z',
    truncated: false,
    pull_requests: [],
    issues: [],
    ...overrides,
  };
}

describe('GitHub snapshot collection ceiling', () => {
  it('accepts collector-complete issue and pull-request inventories through 1,000 items', () => {
    for (const count of [101, 1_000]) {
      assert.equal(
        validateGitHubSnapshot(
          snapshot({ issues: Array.from({ length: count }, (_, index) => issue(index + 1)) }),
        ).issues.length,
        count,
      );
      assert.equal(
        validateGitHubSnapshot(
          snapshot({
            pull_requests: Array.from({ length: count }, (_, index) =>
              pullRequest(index + 1),
            ),
          }),
        ).pull_requests.length,
        count,
      );
    }
  });

  it('accepts complete review evidence through 1,000 items and rejects limit-plus-one input', () => {
    for (const count of [101, 1_000]) {
      const validated = validateGitHubSnapshot(
        snapshot({
          pull_requests: [
            pullRequest(
              1,
              Array.from({ length: count }, (_, index) => review(index + 1)),
            ),
          ],
        }),
      );
      assert.equal(validated.pull_requests[0].reviews.length, count);
    }

    assert.throws(
      () =>
        validateGitHubSnapshot(
          snapshot({ issues: Array.from({ length: 1_001 }, (_, index) => issue(index + 1)) }),
        ),
      /Invalid GitHub snapshot: invalid issues/,
    );
    assert.throws(
      () =>
        validateGitHubSnapshot(
          snapshot({
            pull_requests: [
              pullRequest(
                1,
                Array.from({ length: 1_001 }, (_, index) => review(index + 1)),
              ),
            ],
          }),
        ),
      /Invalid GitHub snapshot: invalid reviews/,
    );
  });
});
