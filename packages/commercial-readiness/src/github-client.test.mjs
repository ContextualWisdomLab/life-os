import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  collectRepositorySnapshot,
  GitHubApiClient,
  findReadinessIssues,
  mergeEligiblePullRequests,
  syncReadinessIssue,
} from './github-client.mjs';

function jsonResponse(
  value,
  { status = 200, contentType = 'application/json' } = {},
) {
  const body = JSON.stringify(value);
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'content-length': String(Buffer.byteLength(body)),
    },
  });
}

describe('GitHubApiClient', () => {
  it('uses only fixed GitHub API URLs, bounded JSON, no redirects, and generic errors', async () => {
    const calls = [];
    const client = new GitHubApiClient({
      token: 'secret-token-value',
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return jsonResponse({ ok: true });
      },
      timeoutMs: 1000,
      maxResponseBytes: 4096,
    });
    await assert.doesNotReject(() => client.requestJson('/repos/o/r'));
    assert.equal(calls[0].url, 'https://api.github.com/repos/o/r');
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(
      calls[0].options.headers.authorization,
      'Bearer secret-token-value',
    );
    await assert.rejects(
      () => client.requestJson('https://evil.example/path'),
      /Invalid GitHub API path/,
    );
  });

  it('rejects non-JSON and oversized upstream responses without echoing bodies', async () => {
    const nonJson = new GitHubApiClient({
      token: 'token',
      fetchImpl: async () =>
        jsonResponse('sensitive-body', { contentType: 'text/plain' }),
    });
    await assert.rejects(
      () => nonJson.requestJson('/x'),
      new Error('GitHub API response was invalid'),
    );

    const oversized = new GitHubApiClient({
      token: 'token',
      maxResponseBytes: 1024,
      fetchImpl: async () => jsonResponse({ data: 'x'.repeat(2048) }),
    });
    await assert.rejects(
      () => oversized.requestJson('/x'),
      new Error('GitHub API response exceeded the size limit'),
    );
  });
});

describe('readiness issue synchronization', () => {
  it('selects one canonical marker issue and closes automation-owned duplicates with a valid reason', async () => {
    const marker = '<!-- life-os-commercial-readiness-loop:v1 -->';
    const issues = [
      { number: 30, state: 'open', body: marker, pull_request: null },
      { number: 20, state: 'open', body: `${marker}\nold`, pull_request: null },
      {
        number: 40,
        state: 'open',
        body: `copied text ${marker}`,
        pull_request: null,
      },
      { number: 10, state: 'open', body: 'human issue', pull_request: null },
    ];
    assert.deepEqual(
      findReadinessIssues(issues, marker).map((item) => item.number),
      [20, 30],
    );

    const calls = [];
    const client = {
      async requestJson(path, options = {}) {
        calls.push({ path, options });
        if (path.includes('/issues?')) return issues;
        return { number: 20 };
      },
    };
    await syncReadinessIssue(client, 'o/r', {
      marker,
      title: 'Readiness',
      body: `${marker}\nnew`,
    });
    assert.equal(
      calls.some(
        (call) =>
          call.path.endsWith('/issues/20') && call.options.method === 'PATCH',
      ),
      true,
    );
    const duplicateClose = calls.find((call) =>
      call.path.endsWith('/issues/30'),
    );
    assert.equal(duplicateClose.options.body.state, 'closed');
    assert.equal(duplicateClose.options.body.state_reason, 'not_planned');
    assert.equal(
      duplicateClose.options.body.body,
      `${marker}\n\nSuperseded by #20.`,
    );
    assert.equal(
      calls.some((call) => call.path.endsWith('/issues/40')),
      false,
    );
  });
});

describe('repository snapshot evidence', () => {
  it('uses current review commit identity plus newest workflow and status evidence', async () => {
    const headSha = 'a'.repeat(40);
    const baseSha = 'b'.repeat(40);
    const client = {
      async requestJson(path) {
        if (path.startsWith('/repos/o/r/pulls?')) return [{ number: 7 }];
        if (path.startsWith('/repos/o/r/issues?')) return [];
        if (path === '/repos/o/r/pulls/7') {
          return {
            number: 7,
            title: 'feat: current evidence only',
            state: 'open',
            draft: false,
            mergeable: true,
            mergeable_state: 'clean',
            author_association: 'OWNER',
            base: { ref: 'main', sha: baseSha },
            head: { sha: headSha, repo: { full_name: 'o/r' } },
          };
        }
        if (path.startsWith('/repos/o/r/pulls/7/reviews?')) {
          return [
            {
              user: { login: 'reviewer-a' },
              state: 'APPROVED',
              submitted_at: '2026-08-03T07:30:00Z',
              commit_id: headSha,
            },
          ];
        }
        if (path.startsWith('/repos/o/r/actions/runs?')) {
          return {
            total_count: 2,
            workflow_runs: [
              {
                id: 100,
                name: 'CI',
                status: 'completed',
                conclusion: 'success',
                head_sha: headSha,
                run_attempt: 2,
                updated_at: '2026-08-03T07:00:00Z',
                pull_requests: [{ number: 7 }],
              },
              {
                id: 101,
                name: 'CI',
                status: 'completed',
                conclusion: 'failure',
                head_sha: headSha,
                run_attempt: 1,
                updated_at: '2026-08-03T06:00:00Z',
                pull_requests: [{ number: 7 }],
              },
            ],
          };
        }
        if (path.startsWith(`/repos/o/r/commits/${headSha}/statuses?`)) {
          return [
            {
              id: 200,
              context: 'CodeRabbit',
              state: 'success',
              sha: headSha,
              created_at: '2026-08-03T07:00:00Z',
            },
            {
              id: 201,
              context: 'CodeRabbit',
              state: 'pending',
              sha: headSha,
              created_at: '2026-08-03T06:00:00Z',
            },
          ];
        }
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
    const snapshot = await collectRepositorySnapshot(client, 'o/r', {
      policy: {
        default_branch: 'main',
        trusted_author_associations: ['OWNER'],
        required_workflows: ['CI'],
        required_statuses: ['CodeRabbit'],
        merge_method: 'squash',
      },
      commitSha: 'c'.repeat(40),
      generatedAt: '2026-08-03T08:00:00Z',
    });
    const pullRequest = snapshot.pull_requests[0];
    assert.equal(pullRequest.reviews[0].commit_id, headSha);
    assert.equal(pullRequest.workflows[0].conclusion, 'failure');
    assert.equal(pullRequest.statuses[0].state, 'pending');
    assert.equal(pullRequest.eligible, false);
    assert.ok(pullRequest.blockers.includes('workflow-not-successful:CI'));
    assert.ok(
      pullRequest.blockers.includes('status-not-successful:CodeRabbit'),
    );
  });

  it('paginates issue evidence instead of silently truncating the repository view', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      number: index + 1,
      title: `Issue ${index + 1}`,
      state: 'open',
      labels: [],
    }));
    const client = {
      async requestJson(path) {
        if (path.startsWith('/repos/o/r/pulls?')) return [];
        if (path.includes('/repos/o/r/issues?') && path.endsWith('&page=1'))
          return firstPage;
        if (path.includes('/repos/o/r/issues?') && path.endsWith('&page=2')) {
          return [
            { number: 101, title: 'Issue 101', state: 'open', labels: [] },
          ];
        }
        throw new Error(`Unexpected path: ${path}`);
      },
    };
    const snapshot = await collectRepositorySnapshot(client, 'o/r', {
      policy: {
        default_branch: 'main',
        trusted_author_associations: ['OWNER'],
        required_workflows: [],
        required_statuses: [],
        merge_method: 'squash',
      },
      commitSha: 'd'.repeat(40),
      generatedAt: '2026-08-03T08:00:00Z',
    });
    assert.equal(snapshot.issues.length, 101);
    assert.equal(snapshot.truncated, false);
  });
});

describe('mergeEligiblePullRequests', () => {
  it('runs in dry-run mode without mutations', async () => {
    let mergeCalls = 0;
    const result = await mergeEligiblePullRequests({
      repository: 'o/r',
      dryRun: true,
      policy: {
        default_branch: 'main',
        trusted_author_associations: ['OWNER'],
        required_workflows: [],
        required_statuses: [],
        merge_method: 'squash',
      },
      collectPullRequests: async () => [],
      mergePullRequest: async () => {
        mergeCalls += 1;
      },
    });
    assert.deepEqual(result, []);
    assert.equal(mergeCalls, 0);
  });

  it('rechecks the exact head immediately before a squash merge', async () => {
    const headSha = 'a'.repeat(40);
    const candidate = {
      number: 8,
      title: 'ready',
      state: 'open',
      draft: false,
      mergeable: true,
      mergeable_state: 'clean',
      base_ref: 'main',
      head_sha: headSha,
      head_repo: 'o/r',
      repository: 'o/r',
      author_association: 'OWNER',
      behind_by: 0,
      reviews: [
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-08-03T06:00:00Z',
          commit_id: headSha,
        },
      ],
      unresolved_threads: 0,
      workflows: [],
      statuses: [],
    };
    let collections = 0;
    const merges = [];
    const result = await mergeEligiblePullRequests({
      repository: 'o/r',
      dryRun: false,
      policy: {
        default_branch: 'main',
        trusted_author_associations: ['OWNER'],
        required_workflows: [],
        required_statuses: [],
        merge_method: 'squash',
      },
      collectPullRequests: async () => {
        collections += 1;
        return [candidate];
      },
      mergePullRequest: async (number, expectedHeadSha, method) => {
        merges.push({ number, expectedHeadSha, method });
        return { merged: true };
      },
    });
    assert.equal(collections, 2);
    assert.deepEqual(merges, [
      { number: 8, expectedHeadSha: headSha, method: 'squash' },
    ]);
    assert.deepEqual(result, [{ number: 8, action: 'merged' }]);
  });

  it('fails closed when the merge API response does not explicitly prove success', async () => {
    const headSha = 'a'.repeat(40);
    const candidate = {
      number: 8,
      title: 'ready',
      state: 'open',
      draft: false,
      mergeable: true,
      mergeable_state: 'clean',
      base_ref: 'main',
      head_sha: headSha,
      head_repo: 'o/r',
      repository: 'o/r',
      author_association: 'OWNER',
      behind_by: 0,
      reviews: [
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-08-03T06:00:00Z',
          commit_id: headSha,
        },
      ],
      unresolved_threads: 0,
      workflows: [],
      statuses: [],
    };
    const result = await mergeEligiblePullRequests({
      repository: 'o/r',
      dryRun: false,
      policy: {
        default_branch: 'main',
        trusted_author_associations: ['OWNER'],
        required_workflows: [],
        required_statuses: [],
        merge_method: 'squash',
      },
      collectPullRequests: async () => [candidate],
      mergePullRequest: async () => ({}),
    });
    assert.deepEqual(result, [
      { number: 8, action: 'blocked', blockers: ['merge-response-invalid'] },
    ]);
  });

  it('refuses to merge when the head moves between evaluation and mutation', async () => {
    const first = {
      number: 8,
      title: 'ready',
      state: 'open',
      draft: false,
      mergeable: true,
      mergeable_state: 'clean',
      base_ref: 'main',
      head_sha: 'a'.repeat(40),
      head_repo: 'o/r',
      repository: 'o/r',
      author_association: 'OWNER',
      behind_by: 0,
      reviews: [
        {
          actor: 'reviewer-a',
          state: 'APPROVED',
          submitted_at: '2026-08-03T06:00:00Z',
          commit_id: 'a'.repeat(40),
        },
      ],
      unresolved_threads: 0,
      workflows: [],
      statuses: [],
    };
    let calls = 0;
    let merged = false;
    const result = await mergeEligiblePullRequests({
      repository: 'o/r',
      dryRun: false,
      policy: {
        default_branch: 'main',
        trusted_author_associations: ['OWNER'],
        required_workflows: [],
        required_statuses: [],
        merge_method: 'squash',
      },
      collectPullRequests: async () => {
        calls += 1;
        return calls === 1 ? [first] : [{ ...first, head_sha: 'b'.repeat(40) }];
      },
      mergePullRequest: async () => {
        merged = true;
      },
    });
    assert.equal(merged, false);
    assert.deepEqual(result, [
      { number: 8, action: 'blocked', blockers: ['head-changed'] },
    ]);
  });
});
