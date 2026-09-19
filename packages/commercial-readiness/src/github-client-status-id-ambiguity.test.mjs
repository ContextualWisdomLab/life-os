import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);

async function collectWithStatuses(statuses) {
  const client = {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: reject duplicate status identity',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: baseSha },
          head: { sha: headSha, repo: { full_name: 'o/r' } },
          user: { login: 'author-a' },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        return [
          {
            user: { login: 'reviewer-a' },
            state: 'APPROVED',
            submitted_at: '2026-09-07T07:00:00Z',
            commit_id: headSha,
          },
        ];
      }
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) {
        return statuses;
      }
      if (path.startsWith('/repos/o/r/compare/')) {
        return {
          behind_by: 0,
          url: `https://api.github.com/repos/o/r/compare/${baseSha}...${headSha}`,
          base_commit: { sha: baseSha },
          merge_base_commit: { sha: baseSha },
        };
      }
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

  return await collectRepositorySnapshot(client, 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: [],
      required_statuses: ['CodeRabbit'],
      merge_method: 'squash',
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-07T07:05:00Z',
  });
}

it('fails closed when one GitHub commit-status id carries contradictory authority', async () => {
  const snapshot = await collectWithStatuses([
    {
      id: 100,
      context: 'CodeRabbit',
      state: 'success',
      sha: headSha,
      created_at: '2026-09-07T07:00:00Z',
    },
    {
      id: 100,
      context: 'CodeRabbit',
      state: 'failure',
      sha: headSha,
      created_at: '2026-09-07T07:00:00Z',
    },
  ]);

  const [pullRequest] = snapshot.pull_requests;
  assert.equal(pullRequest.eligible, false);
  assert.ok(pullRequest.blockers.includes('status-not-successful:CodeRabbit'));
  assert.deepEqual(pullRequest.statuses, [
    { context: 'CodeRabbit', state: 'invalid', sha: headSha },
  ]);
});

it('taints prior success when a reused status id appears with mismatched provenance', async () => {
  const snapshot = await collectWithStatuses([
    {
      id: 200,
      context: 'CodeRabbit',
      state: 'success',
      sha: headSha,
      created_at: '2026-09-07T07:00:00Z',
    },
    {
      id: 200,
      context: 'Other',
      state: 'failure',
      sha: baseSha,
      created_at: '2026-09-07T07:00:01Z',
    },
  ]);

  const [pullRequest] = snapshot.pull_requests;
  assert.equal(pullRequest.eligible, false);
  assert.ok(pullRequest.blockers.includes('status-not-successful:CodeRabbit'));
  assert.deepEqual(pullRequest.statuses, [
    { context: 'CodeRabbit', state: 'invalid', sha: headSha },
    { context: 'Other', state: 'invalid', sha: headSha },
  ]);
});
