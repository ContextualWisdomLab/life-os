import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const SOURCE_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));

const PROBE = String.raw`
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { collectRepositorySnapshot } = await import(
  pathToFileURL(join(process.cwd(), 'github-client.mjs')).href
);
const headSha = 'a'.repeat(40);
const baseSha = 'b'.repeat(40);
const client = {
  async requestJson(path) {
    if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
    if (path.startsWith('/repos/o/r/issues?')) return [];
    if (path === '/repos/o/r/pulls/7') {
      return {
        number: 7,
        title: 'fix: preserve deterministic evidence ordering',
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
          submitted_at: '2026-09-14T00:00:00Z',
          commit_id: headSha,
        },
      ];
    }
    if (path.startsWith('/repos/o/r/actions/runs?')) {
      return {
        total_count: 2,
        workflow_runs: [
          {
            id: 1,
            name: 'aa.a',
            status: 'completed',
            conclusion: 'success',
            head_sha: headSha,
            run_attempt: 1,
            updated_at: '2026-09-14T00:00:01Z',
            pull_requests: [{ number: 7 }],
          },
          {
            id: 2,
            name: 'ab.a',
            status: 'completed',
            conclusion: 'success',
            head_sha: headSha,
            run_attempt: 1,
            updated_at: '2026-09-14T00:00:02Z',
            pull_requests: [{ number: 7 }],
          },
        ],
      };
    }
    if (path.startsWith('/repos/o/r/commits/' + headSha + '/statuses?')) {
      return [
        {
          id: 1,
          context: 'aa.a',
          state: 'success',
          sha: headSha,
          created_at: '2026-09-14T00:00:01Z',
        },
        {
          id: 2,
          context: 'ab.a',
          state: 'success',
          sha: headSha,
          created_at: '2026-09-14T00:00:02Z',
        },
      ];
    }
    if (path === '/repos/o/r/compare/' + baseSha + '...' + headSha + '?per_page=1&page=2') {
      return {
        url: 'https://api.github.com/repos/o/r/compare/' + baseSha + '...' + headSha,
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
    throw new Error('Unexpected path: ' + path);
  },
};
const snapshot = await collectRepositorySnapshot(client, 'o/r', {
  policy: {
    default_branch: 'main',
    required_workflows: ['aa.a', 'ab.a'],
    required_statuses: ['aa.a', 'ab.a'],
    merge_method: 'squash',
  },
  commitSha: 'c'.repeat(40),
  generatedAt: '2026-09-14T00:01:00Z',
});
const pullRequest = snapshot.pull_requests[0];
process.stdout.write(JSON.stringify({
  workflows: pullRequest.workflows.map((run) => run.name),
  statuses: pullRequest.statuses.map((status) => status.context),
}));
`;

function evidenceOrderFor(locale) {
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', PROBE], {
    cwd: SOURCE_DIRECTORY,
    env: { ...process.env, LANG: locale, LC_ALL: locale },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || `probe failed for ${locale}`);
  return JSON.parse(result.stdout);
}

describe('GitHub merge-evidence ordering', () => {
  it('keeps workflow and status evidence byte-stable across ambient locales', () => {
    const englishOrder = evidenceOrderFor('en_US.UTF-8');
    const danishOrder = evidenceOrderFor('da_DK.UTF-8');

    assert.deepEqual(englishOrder, {
      workflows: ['aa.a', 'ab.a'],
      statuses: ['aa.a', 'ab.a'],
    });
    assert.deepEqual(danishOrder, englishOrder);
  });
});
