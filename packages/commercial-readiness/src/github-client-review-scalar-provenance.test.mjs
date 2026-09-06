import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const HEAD_SHA = 'a'.repeat(40);
const BASE_SHA = 'b'.repeat(40);

function fixtureClient(review) {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: reject malformed review scalar authority',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: BASE_SHA },
          head: { sha: HEAD_SHA, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) return [review];
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${HEAD_SHA}/statuses?`)) return [];
      if (path.startsWith('/repos/o/r/compare/')) return { behind_by: 0 };
      if (path === '/graphql') {
        return {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  nodes: [],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            },
          },
        };
      }
      throw new Error(`Unexpected path: ${path}`);
    },
  };
}

async function collect(review) {
  return await collectRepositorySnapshot(fixtureClient(review), 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: [],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-06T01:10:00Z',
  });
}

function assertMalformedReviewBlocked(snapshot) {
  const [pullRequest] = snapshot.pull_requests;
  assert.equal(pullRequest.eligible, false);
  assert.ok(pullRequest.blockers.includes('review-evidence-invalid'));
  assert.ok(pullRequest.blockers.includes('missing-approval'));
}

describe('review scalar provenance', () => {
  it('does not coerce a non-string reviewer login into approval authority', async () => {
    const snapshot = await collect({
      user: { login: 123 },
      state: 'APPROVED',
      submitted_at: '2026-09-06T01:00:00Z',
      commit_id: HEAD_SHA,
    });

    assertMalformedReviewBlocked(snapshot);
  });

  it('does not parse a non-string submitted_at scalar into approval authority', async () => {
    const snapshot = await collect({
      user: { login: 'reviewer-a' },
      state: 'APPROVED',
      submitted_at: 123,
      commit_id: HEAD_SHA,
    });

    assertMalformedReviewBlocked(snapshot);
  });
});
