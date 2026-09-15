import assert from 'node:assert/strict';
import { it } from 'node:test';
import {
  collectRepositorySnapshot,
  mergePullRequestThroughApi,
} from './github-client.mjs';

const LOWER_HEAD = 'a'.repeat(40);
const LOWER_BASE = 'b'.repeat(40);
const LOWER_SNAPSHOT = 'd'.repeat(40);

const POLICY = Object.freeze({
  default_branch: 'main',
  trusted_author_associations: ['OWNER'],
  required_workflows: [],
  required_statuses: [],
  merge_method: 'squash',
});

function emptyRepositoryClient() {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      throw new Error(`Unexpected path: ${path}`);
    },
  };
}

function onePullRequestClient({ headSha = LOWER_HEAD, baseSha = LOWER_BASE, comparePayload }) {
  return {
    async requestJson(path) {
      if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
      if (path.startsWith('/repos/o/r/issues?')) return [];
      if (path === '/repos/o/r/pulls/7') {
        return {
          number: 7,
          title: 'SHA canonicality fixture',
          state: 'open',
          draft: false,
          mergeable: true,
          mergeable_state: 'clean',
          author_association: 'OWNER',
          user: { login: 'author-a' },
          base: { ref: 'main', sha: baseSha },
          head: { sha: headSha, repo: { full_name: 'o/r' } },
        };
      }
      if (path.startsWith('/repos/o/r/pulls/7/reviews?')) return [];
      if (path.startsWith('/repos/o/r/actions/runs?')) {
        return { total_count: 0, workflow_runs: [] };
      }
      if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) return [];
      if (path.startsWith('/repos/o/r/compare/')) {
        return (
          comparePayload ?? {
            url: `https://api.github.com/repos/o/r/compare/${baseSha}...${headSha}`,
            base_commit: { sha: baseSha },
            merge_base_commit: { sha: baseSha },
            behind_by: 0,
          }
        );
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

async function collect(client, commitSha = LOWER_SNAPSHOT) {
  return await collectRepositorySnapshot(client, 'o/r', {
    policy: POLICY,
    commitSha,
    generatedAt: '2026-09-07T01:00:00Z',
  });
}

it('rejects an uppercase snapshot commit SHA instead of recanonicalizing it', async () => {
  await assert.rejects(
    collect(emptyRepositoryClient(), 'D'.repeat(40)),
    /Snapshot commit SHA is invalid/,
  );
});

it('rejects an uppercase pull-request head before it can become merge evidence', async () => {
  await assert.rejects(
    collect(onePullRequestClient({ headSha: 'A'.repeat(40) })),
    /GitHub pull request head was invalid/,
  );
});

it('rejects an uppercase pull-request base before comparison authority is collected', async () => {
  await assert.rejects(
    collect(onePullRequestClient({ baseSha: 'B'.repeat(40) })),
    /GitHub pull request base was invalid/,
  );
});

it('does not grant zero-behind authority to uppercase compare commit aliases', async () => {
  const snapshot = await collect(
    onePullRequestClient({
      comparePayload: {
        url: `https://api.github.com/repos/o/r/compare/${LOWER_BASE}...${LOWER_HEAD}`,
        base_commit: { sha: 'B'.repeat(40) },
        merge_base_commit: { sha: 'B'.repeat(40) },
        behind_by: 0,
      },
    }),
  );

  assert.equal(snapshot.pull_requests[0].behind_by, -1);
  assert.ok(snapshot.pull_requests[0].blockers.includes('base-out-of-date'));
});

it('rejects an uppercase expected head before issuing the merge mutation', async () => {
  let mutationCount = 0;
  const client = {
    async requestJson() {
      mutationCount += 1;
      return { merged: true };
    },
  };

  await assert.rejects(
    mergePullRequestThroughApi(client, 'o/r', 7, 'A'.repeat(40), 'squash'),
    /Merge request is invalid/,
  );
  assert.equal(mutationCount, 0);
});

it('preserves canonical lowercase SHA evidence', async () => {
  const snapshot = await collect(onePullRequestClient({}));
  assert.equal(snapshot.commit_sha, LOWER_SNAPSHOT);
  assert.equal(snapshot.pull_requests[0].head_sha, LOWER_HEAD);
  assert.equal(snapshot.pull_requests[0].behind_by, 0);
});
