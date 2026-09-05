import { evaluatePullRequestForMerge } from './pr-gate.mjs';

const API_ORIGIN = 'https://api.github.com';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;
const API_PAGE_SIZE = 100;
const MAX_API_PAGES = 10;
/** Maximum number of attempts for one idempotent GitHub GET, including the first request. */
const MAX_READ_ATTEMPTS = 3;
/** Backoff delays after the first and second retryable GET failures, in milliseconds. */
const READ_RETRY_DELAYS_MS = [100, 250];
/** Transient server statuses that may be retried only when the request method is GET. */
const READ_RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/i;

function assertRepository(repository) {
  if (typeof repository !== 'string' || !REPOSITORY_PATTERN.test(repository)) {
    throw new Error('Repository identifier is invalid');
  }
  return repository;
}

async function readBoundedText(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error('GitHub API response exceeded the size limit');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error('GitHub API response exceeded the size limit');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/**
 * Wait for the bounded backoff associated with a completed retryable GET attempt.
 *
 * @param {number} attempt One-based completed attempt; valid retry waits are attempts 1 and 2.
 * @returns {Promise<void>} Resolves after the corresponding 100 ms or 250 ms delay.
 */
function waitForReadRetry(attempt) {
  const delay = READ_RETRY_DELAYS_MS[attempt - 1];
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export class GitHubApiClient {
  constructor({
    token,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  }) {
    if (typeof token !== 'string' || !token.trim()) {
      throw new Error('GitHub token is required');
    }
    if (typeof fetchImpl !== 'function')
      throw new Error('Fetch implementation is required');
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 100 ||
      timeoutMs > 60_000
    ) {
      throw new Error('GitHub timeout is invalid');
    }
    if (
      !Number.isSafeInteger(maxResponseBytes) ||
      maxResponseBytes < 1024 ||
      maxResponseBytes > 5 * 1024 * 1024
    ) {
      throw new Error('GitHub response limit is invalid');
    }
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.maxResponseBytes = maxResponseBytes;
  }

  /**
   * Request bounded JSON from the GitHub API while preserving mutation exactly-once semantics.
   *
   * GET requests retry only HTTP 500, 502, 503, or 504 responses, for at most three total
   * attempts with 100 ms then 250 ms backoff and a fresh configured timeout per attempt.
   * Every non-GET request is attempted exactly once and is never replayed automatically.
   *
   * @param {string} path Absolute GitHub API path constrained to the configured API origin.
   * @param {{method?: string, body?: unknown, headers?: Record<string, string>}} [options] Request options.
   * @returns {Promise<unknown>} Parsed bounded JSON response, or null for an empty successful body.
   */
  async requestJson(path, { method = 'GET', body, headers = {} } = {}) {
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      /[\u0000-\u001f\u007f]/.test(path) ||
      path.includes('\\')
    ) {
      throw new Error('Invalid GitHub API path');
    }
    const maximumAttempts = method === 'GET' ? MAX_READ_ATTEMPTS : 1;
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let shouldRetry = false;
      try {
        const response = await this.fetchImpl(`${API_ORIGIN}${path}`, {
          method,
          redirect: 'error',
          signal: controller.signal,
          headers: {
            accept: 'application/vnd.github+json',
            authorization: `Bearer ${this.token}`,
            'user-agent': 'life-os-commercial-readiness',
            'x-github-api-version': '2022-11-28',
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const text = await readBoundedText(response, this.maxResponseBytes);
        shouldRetry =
          attempt < maximumAttempts &&
          READ_RETRYABLE_STATUSES.has(response.status);
        if (shouldRetry) continue;
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('json')) {
          throw new Error('GitHub API response was invalid');
        }
        if (!response.ok) {
          throw new Error(
            `GitHub API request failed with status ${response.status}`,
          );
        }
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          throw new Error('GitHub API response was invalid');
        }
      } catch (error) {
        if (error?.name === 'AbortError')
          throw new Error('GitHub API request timed out');
        throw error;
      } finally {
        clearTimeout(timer);
        if (shouldRetry) await waitForReadRetry(attempt);
      }
    }
    throw new Error('GitHub API request retry invariant failed');
  }
}

export function findReadinessIssues(issues, marker) {
  return (Array.isArray(issues) ? issues : [])
    .filter(
      (issue) =>
        issue &&
        !issue.pull_request &&
        issue.state === 'open' &&
        typeof issue.body === 'string' &&
        issue.body.startsWith(marker),
    )
    .sort((left, right) => left.number - right.number);
}

export async function syncReadinessIssue(
  client,
  repository,
  { marker, title, body },
) {
  assertRepository(repository);
  if (
    typeof body !== 'string' ||
    !body.startsWith(marker) ||
    body.length > 60_000
  ) {
    throw new Error('Readiness issue body is invalid');
  }
  const issues = await collectPaginatedArray(
    client,
    `/repos/${repository}/issues?state=open`,
    'GitHub issue response was invalid',
  );
  const matches = findReadinessIssues(issues, marker);
  let canonical;
  if (matches.length === 0) {
    canonical = await client.requestJson(`/repos/${repository}/issues`, {
      method: 'POST',
      body: {
        title,
        body,
        labels: ['commercial-readiness', 'automation'],
      },
    });
  } else {
    canonical = await client.requestJson(
      `/repos/${repository}/issues/${matches[0].number}`,
      {
        method: 'PATCH',
        body: { title, body },
      },
    );
    for (const duplicate of matches.slice(1)) {
      await client.requestJson(
        `/repos/${repository}/issues/${duplicate.number}`,
        {
          method: 'PATCH',
          body: {
            state: 'closed',
            state_reason: 'not_planned',
            body: `${marker}\n\nSuperseded by #${canonical.number}.`,
          },
        },
      );
    }
  }
  return canonical;
}

/**
 * Normalize one untrusted GitHub review while retaining immutable commit binding evidence.
 *
 * The evaluator separately validates actor, state, timestamp, and whether an approval's
 * `commit_id` equals the exact pull-request head. Missing or malformed values remain
 * bounded scalar evidence rather than being inferred from submission time or current state.
 *
 * @param {unknown} review Raw GitHub REST pull-request review payload.
 * @returns {{actor: string, state: string, submitted_at: unknown, commit_id: string}} Bounded review evidence.
 */
function normalizeReview(review) {
  return {
    actor: String(review?.user?.login ?? ''),
    state: String(review?.state ?? ''),
    submitted_at: review?.submitted_at ?? null,
    commit_id: String(review?.commit_id ?? ''),
  };
}

async function collectPaginatedArray(client, path, errorMessage) {
  const values = [];
  const separator = path.includes('?') ? '&' : '?';
  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const payload = await client.requestJson(
      `${path}${separator}per_page=${API_PAGE_SIZE}&page=${page}`,
    );
    if (!Array.isArray(payload) || payload.length > API_PAGE_SIZE) {
      throw new Error(errorMessage);
    }
    values.push(...payload);
    if (payload.length < API_PAGE_SIZE) return values;
  }
  throw new Error(`${errorMessage} exceeded the page limit`);
}

/**
 * Check whether one pull-request-triggered workflow run belongs to the evaluated PR.
 *
 * GitHub can return multiple pull-request runs for the same head SHA when one commit is
 * proposed against different bases. Missing or malformed association evidence fails closed.
 *
 * @param {unknown} run Untrusted workflow-run payload from the GitHub Actions API.
 * @param {number} pullRequestNumber Repository-local pull request number being evaluated.
 * @returns {boolean} True only when GitHub explicitly associates the run with that PR.
 */
function workflowRunBelongsToPullRequest(run, pullRequestNumber) {
  if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
    return false;
  }
  return (Array.isArray(run?.pull_requests) ? run.pull_requests : []).some(
    (pullRequest) => pullRequest?.number === pullRequestNumber,
  );
}

/**
 * Collect bounded workflow-run evidence for one exact head and one exact pull request.
 *
 * The Actions endpoint is queried by head SHA for pagination efficiency, then every result
 * is constrained by GitHub's immutable pull-request association before it can reach merge
 * evaluation. Because the endpoint uses offset pagination over a live newest-first list,
 * the traversal also requires a stable `total_count` and unique positive run IDs across
 * every page. Concurrent insertion/deletion that could shift a page boundary therefore
 * fails closed instead of allowing an older successful run to hide newer evidence.
 *
 * @param {object} client Bounded GitHub API client.
 * @param {string} repository Canonical owner/repository identifier.
 * @param {string} headSha Exact current pull-request head SHA.
 * @param {number} pullRequestNumber Repository-local pull request number.
 * @returns {Promise<unknown[]>} Workflow runs explicitly associated with the evaluated PR.
 */
async function collectWorkflowRuns(
  client,
  repository,
  headSha,
  pullRequestNumber,
) {
  const values = [];
  const seenRunIds = new Set();
  let expectedTotal = null;
  let collectionComplete = false;
  for (let page = 1; page <= MAX_API_PAGES; page += 1) {
    const payload = await client.requestJson(
      `/repos/${repository}/actions/runs?head_sha=${encodeURIComponent(
        headSha,
      )}&event=pull_request&per_page=${API_PAGE_SIZE}&page=${page}`,
    );
    const pageValues = payload?.workflow_runs;
    if (
      !Array.isArray(pageValues) ||
      pageValues.length > API_PAGE_SIZE ||
      !Number.isSafeInteger(payload?.total_count) ||
      payload.total_count < 0
    ) {
      throw new Error('GitHub workflow run response was invalid');
    }
    if (expectedTotal === null) {
      expectedTotal = payload.total_count;
    } else if (payload.total_count !== expectedTotal) {
      throw new Error('GitHub workflow run response changed during pagination');
    }
    for (const run of pageValues) {
      if (!Number.isSafeInteger(run?.id) || run.id <= 0) {
        throw new Error('GitHub workflow run response was invalid');
      }
      if (seenRunIds.has(run.id)) {
        throw new Error('GitHub workflow run response changed during pagination');
      }
      seenRunIds.add(run.id);
    }
    values.push(...pageValues);
    if (values.length > expectedTotal) {
      throw new Error('GitHub workflow run response changed during pagination');
    }
    if (values.length === expectedTotal) {
      collectionComplete = true;
      break;
    }
    if (pageValues.length < API_PAGE_SIZE) {
      throw new Error('GitHub workflow run response changed during pagination');
    }
  }
  if (!collectionComplete) {
    throw new Error('GitHub workflow run response exceeded the page limit');
  }
  return values.filter((run) =>
    workflowRunBelongsToPullRequest(run, pullRequestNumber),
  );
}

/**
 * Count unresolved GitHub review threads without treating ambiguous GraphQL evidence as resolved.
 *
 * Every returned thread must expose an explicit boolean `isResolved`. Pagination must expose
 * a boolean `hasNextPage`, and any claimed next page must provide a non-empty string cursor.
 * Malformed thread or pagination evidence throws before it can reduce the merge blocker count.
 *
 * @param {object} client Bounded GitHub API client used for GraphQL requests.
 * @param {string} repository Canonical owner/repository identifier.
 * @param {number} number Repository-local pull request number.
 * @returns {Promise<number>} Exact unresolved-thread count from a complete bounded traversal.
 */
async function unresolvedThreadCount(client, repository, number) {
  const [owner, name] = repository.split('/');
  const query = `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{isResolved}pageInfo{hasNextPage endCursor}}}}}`;
  let cursor = null;
  let count = 0;
  let pages = 0;
  do {
    const payload = await client.requestJson('/graphql', {
      method: 'POST',
      body: { query, variables: { owner, name, number, cursor } },
    });
    if (Array.isArray(payload?.errors) && payload.errors.length > 0) {
      throw new Error('GitHub review thread query failed');
    }
    const threads = payload?.data?.repository?.pullRequest?.reviewThreads;
    if (!threads || !Array.isArray(threads.nodes)) {
      throw new Error('GitHub review thread response was invalid');
    }
    if (threads.nodes.some((node) => typeof node?.isResolved !== 'boolean')) {
      throw new Error('GitHub review thread response was invalid');
    }
    count += threads.nodes.filter((node) => node.isResolved === false).length;
    const pageInfo = threads.pageInfo;
    if (!pageInfo || typeof pageInfo.hasNextPage !== 'boolean') {
      throw new Error('GitHub review thread response pagination was invalid');
    }
    if (pageInfo.hasNextPage) {
      if (typeof pageInfo.endCursor !== 'string' || !pageInfo.endCursor) {
        throw new Error('GitHub review thread response pagination was invalid');
      }
      cursor = pageInfo.endCursor;
    } else {
      cursor = null;
    }
    pages += 1;
    if (pages > MAX_API_PAGES) {
      throw new Error('GitHub review thread response exceeded the page limit');
    }
  } while (cursor);
  return count;
}

function runIsNewer(candidate, current) {
  if (candidate.id !== current.id) return candidate.id > current.id;
  if (candidate.run_attempt !== current.run_attempt) {
    return candidate.run_attempt > current.run_attempt;
  }
  const candidateTime = Date.parse(candidate.updated_at ?? '') || 0;
  const currentTime = Date.parse(current.updated_at ?? '') || 0;
  return candidateTime > currentTime;
}

function latestWorkflowRuns(runs) {
  const latest = new Map();
  for (const run of Array.isArray(runs) ? runs : []) {
    const normalized = {
      id: Number.isSafeInteger(run?.id) ? run.id : 0,
      name: String(run?.name ?? ''),
      status: String(run?.status ?? ''),
      conclusion: run?.conclusion ?? null,
      head_sha: String(run?.head_sha ?? ''),
      run_attempt: Number(run?.run_attempt ?? 0),
      updated_at: run?.updated_at ?? null,
    };
    if (!normalized.name) continue;
    const current = latest.get(normalized.name);
    if (!current || runIsNewer(normalized, current)) {
      latest.set(normalized.name, normalized);
    }
  }
  return [...latest.values()]
    .map(({ id: _id, ...run }) => run)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function statusIsNewer(candidate, current) {
  if (candidate.id !== current.id) return candidate.id > current.id;
  const candidateTime = Date.parse(candidate.created_at ?? '') || 0;
  const currentTime = Date.parse(current.created_at ?? '') || 0;
  return candidateTime > currentTime;
}

/**
 * Retain only status records that explicitly bind the exact pull-request head SHA.
 *
 * Missing status SHA provenance is not inferred from the commit-scoped endpoint path. A
 * malformed or stale status is discarded before latest-per-context reduction so it cannot
 * satisfy a required exact-head status gate by omission.
 *
 * @param {unknown} statuses Untrusted commit-status records from the GitHub API.
 * @param {string} headSha Exact current pull-request head SHA.
 * @returns {Array<{context: string, state: string, sha: string}>} Latest exact-head status by context.
 */
function latestStatuses(statuses, headSha) {
  const latest = new Map();
  for (const status of Array.isArray(statuses) ? statuses : []) {
    const normalized = {
      id: Number.isSafeInteger(status?.id) ? status.id : 0,
      context: String(status?.context ?? ''),
      state: String(status?.state ?? ''),
      sha: String(status?.sha ?? ''),
      created_at: status?.created_at ?? null,
    };
    if (!normalized.context || normalized.sha !== headSha) continue;
    const current = latest.get(normalized.context);
    if (!current || statusIsNewer(normalized, current)) {
      latest.set(normalized.context, normalized);
    }
  }
  return [...latest.values()]
    .map(({ id: _id, created_at: _createdAt, ...status }) => status)
    .sort((left, right) => left.context.localeCompare(right.context));
}

async function collectOnePullRequest(client, repository, summary, policy) {
  const number = summary.number;
  const detail = await client.requestJson(
    `/repos/${repository}/pulls/${number}`,
  );
  const headSha = String(detail?.head?.sha ?? '');
  if (!SHA_PATTERN.test(headSha)) {
    throw new Error('GitHub pull request head was invalid');
  }
  const [reviews, workflowRuns, statuses, comparePayload, unresolvedThreads] =
    await Promise.all([
      collectPaginatedArray(
        client,
        `/repos/${repository}/pulls/${number}/reviews`,
        'GitHub review response was invalid',
      ),
      collectWorkflowRuns(client, repository, headSha, number),
      collectPaginatedArray(
        client,
        `/repos/${repository}/commits/${headSha}/statuses`,
        'GitHub status response was invalid',
      ),
      client.requestJson(
        `/repos/${repository}/compare/${encodeURIComponent(
          detail.base.sha,
        )}...${encodeURIComponent(headSha)}`,
      ),
      unresolvedThreadCount(client, repository, number),
    ]);

  const pull = {
    number,
    title: String(detail.title ?? ''),
    state: String(detail.state ?? ''),
    draft: detail.draft === true,
    mergeable: detail.mergeable === true,
    mergeable_state: String(detail.mergeable_state ?? 'unknown'),
    base_ref: String(detail.base?.ref ?? ''),
    head_sha: headSha,
    head_repo: String(detail.head?.repo?.full_name ?? ''),
    repository,
    author_association: String(detail.author_association ?? ''),
    behind_by: Number.isSafeInteger(comparePayload?.behind_by)
      ? comparePayload.behind_by
      : -1,
    reviews: reviews.map(normalizeReview),
    unresolved_threads: unresolvedThreads,
    workflows: latestWorkflowRuns(workflowRuns),
    statuses: latestStatuses(statuses, headSha),
  };
  return { ...pull, ...evaluatePullRequestForMerge(pull, policy) };
}

export async function collectRepositorySnapshot(
  client,
  repositoryValue,
  { policy, commitSha, generatedAt },
) {
  const repository = assertRepository(repositoryValue);
  if (!SHA_PATTERN.test(commitSha ?? '')) {
    throw new Error('Snapshot commit SHA is invalid');
  }
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('Snapshot timestamp is invalid');
  }
  const [pullSummaries, issuePayload] = await Promise.all([
    collectPaginatedArray(
      client,
      `/repos/${repository}/pulls?state=open&sort=created&direction=asc`,
      'GitHub pull request list was invalid',
    ),
    collectPaginatedArray(
      client,
      `/repos/${repository}/issues?state=open&sort=created&direction=asc`,
      'GitHub issue list was invalid',
    ),
  ]);
  const pullRequests = [];
  for (const summary of pullSummaries) {
    pullRequests.push(
      await collectOnePullRequest(client, repository, summary, policy),
    );
  }
  const issues = issuePayload
    .filter((issue) => !issue?.pull_request)
    .map((issue) => ({
      number: issue.number,
      title: String(issue.title ?? ''),
      state: String(issue.state ?? ''),
      labels: (Array.isArray(issue.labels) ? issue.labels : []).map((label) =>
        typeof label === 'string' ? label : String(label?.name ?? ''),
      ),
    }));
  return {
    schema: 'life-os.github-snapshot.v1',
    repository,
    commit_sha: commitSha.toLowerCase(),
    generated_at: new Date(generatedAt).toISOString(),
    truncated: false,
    pull_requests: pullRequests,
    issues,
  };
}

export async function mergeEligiblePullRequests({
  repository,
  policy,
  dryRun,
  collectPullRequests,
  mergePullRequest,
}) {
  assertRepository(repository);
  const initial = await collectPullRequests();
  const results = [];
  for (const candidate of initial) {
    const evaluation = evaluatePullRequestForMerge(candidate, policy);
    if (!evaluation.eligible) {
      results.push({
        number: candidate.number,
        action: 'blocked',
        blockers: evaluation.blockers,
      });
      continue;
    }
    if (dryRun) {
      results.push({ number: candidate.number, action: 'would-merge' });
      continue;
    }
    const refreshed = (await collectPullRequests()).find(
      (item) => item.number === candidate.number,
    );
    if (!refreshed) {
      results.push({
        number: candidate.number,
        action: 'blocked',
        blockers: ['not-open'],
      });
      continue;
    }
    if (refreshed.head_sha !== candidate.head_sha) {
      results.push({
        number: candidate.number,
        action: 'blocked',
        blockers: ['head-changed'],
      });
      continue;
    }
    const refreshedEvaluation = evaluatePullRequestForMerge(refreshed, policy);
    if (!refreshedEvaluation.eligible) {
      results.push({
        number: candidate.number,
        action: 'blocked',
        blockers: refreshedEvaluation.blockers,
      });
      continue;
    }
    const result = await mergePullRequest(
      candidate.number,
      candidate.head_sha,
      policy.merge_method,
    );
    results.push({
      number: candidate.number,
      action: result?.merged === false ? 'blocked' : 'merged',
      ...(result?.merged === false
        ? { blockers: ['github-rejected-merge'] }
        : {}),
    });
  }
  return results;
}

export async function mergePullRequestThroughApi(
  client,
  repositoryValue,
  number,
  expectedHeadSha,
  mergeMethod,
) {
  const repository = assertRepository(repositoryValue);
  if (
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    !SHA_PATTERN.test(expectedHeadSha)
  ) {
    throw new Error('Merge request is invalid');
  }
  if (mergeMethod !== 'squash') throw new Error('Merge method is invalid');
  return await client.requestJson(
    `/repos/${repository}/pulls/${number}/merge`,
    {
      method: 'PUT',
      body: { sha: expectedHeadSha, merge_method: 'squash' },
    },
  );
}
