import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);

function clientForRun(run) {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'fix: preserve workflow scalar provenance',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          base: { ref: 'main', sha: baseSha },
          head: { sha: headSha, repo: { full_name: 'o/r' } },
          user: { login: 'pr-author' },
          author_association: 'OWNER',
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
        return [
          {
            user: { login: 'reviewer-a' },
            state: 'APPROVED',
            submitted_at: '2026-09-06T04:45:00Z',
            commit_id: headSha,
          },
        ];
      }
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 1, workflow_runs: [run] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) return [];
      if (
        path ===
        `/repos/o/r/compare/${baseSha}...${headSha}?per_page=1&page=2`
      ) {
        return {
          url: `https://api.github.com/repos/o/r/compare/${baseSha}...${headSha}`,
          behind_by: 0,
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
}

async function evaluateRun(run) {
  const snapshot = await collectRepositorySnapshot(clientForRun(run), 'o/r', {
    policy: {
      default_branch: 'main',
      required_workflows: ['CI'],
      required_statuses: [],
      merge_method: 'squash',
    },
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-06T04:50:00Z',
  });
  return snapshot.pull_requests[0];
}

it('does not coerce malformed workflow identity scalars into exact-head success authority', async () => {
  const canonical = {
    id: 200,
    name: 'CI',
    status: 'completed',
    conclusion: 'success',
    head_sha: headSha,
    run_attempt: 1,
    updated_at: '2026-09-06T04:45:00Z',
    pull_requests: [{ number: 7 }],
  };

  for (const malformed of [
    { ...canonical, name: ['CI'] },
    { ...canonical, status: ['completed'] },
    { ...canonical, head_sha: [headSha] },
    { ...canonical, run_attempt: '1' },
  ]) {
    const pullRequest = await evaluateRun(malformed);
    assert.equal(pullRequest.eligible, false);
    assert.equal(pullRequest.blockers.length, 1);
    assert.ok(
      pullRequest.blockers.includes('missing-workflow:CI') ||
        pullRequest.blockers.includes('workflow-not-successful:CI'),
    );
  }
});
