import assert from 'node:assert/strict';
import { it } from 'node:test';
import { collectRepositorySnapshot } from './github-client.mjs';

const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);

function clientForDetail(detailOverride) {
  const detail = {
    number: 7,
    title: 'fix: preserve PR scalar provenance',
    state: 'open',
    draft: false,
    mergeable: true,
    mergeable_state: 'clean',
    base: { ref: 'main', sha: baseSha },
    head: { sha: headSha, repo: { full_name: 'o/r' } },
    ...detailOverride,
  };
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') return detail;
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
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) return [];
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

const policy = {
  default_branch: 'main',
  required_workflows: [],
  required_statuses: [],
  merge_method: 'squash',
};

async function evaluateDetail(detailOverride) {
  return await collectRepositorySnapshot(clientForDetail(detailOverride), 'o/r', {
    policy,
    commitSha: 'c'.repeat(40),
    generatedAt: '2026-09-06T04:50:00Z',
  });
}

it('keeps the valid scalar fixture eligible before malformed authority cases are introduced', async () => {
  const snapshot = await evaluateDetail({});
  assert.equal(snapshot.pull_requests[0].eligible, true);
  assert.deepEqual(snapshot.pull_requests[0].blockers, []);
});

it('does not coerce malformed pull-request authority scalars into merge eligibility', async () => {
  for (const malformed of [
    { state: ['open'] },
    { mergeable_state: ['clean'] },
    { base: { ref: ['main'], sha: baseSha } },
    { head: { sha: headSha, repo: { full_name: ['o/r'] } } },
  ]) {
    const snapshot = await evaluateDetail(malformed);
    assert.equal(snapshot.pull_requests[0].eligible, false);
  }

  await assert.rejects(
    evaluateDetail({ base: { ref: 'main', sha: [baseSha] } }),
    /GitHub pull request base was invalid/,
  );

  await assert.rejects(
    evaluateDetail({ head: { sha: [headSha], repo: { full_name: 'o/r' } } }),
    /GitHub pull request head was invalid/,
  );
});
