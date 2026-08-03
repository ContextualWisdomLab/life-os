const MANIFEST_SCHEMA = 'life-os.capability-manifest.v1';
const POLICY_SCHEMA = 'life-os.commercial-readiness-policy.v1';

export const MATURITY_LEVELS = Object.freeze([
  'missing',
  'prototype',
  'usable',
  'production',
  'differentiated',
]);

export const MATURITY_RANK = Object.freeze(
  Object.fromEntries(MATURITY_LEVELS.map((level, index) => [level, index])),
);

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+$/;
const REQUIRED_SECURITY_WORKFLOWS = Object.freeze([
  'CI',
  'SAST Semgrep',
  'Security Scan',
  'AppGuardrail',
]);
const REQUIRED_COMMIT_STATUSES = Object.freeze(['CodeRabbit']);
const ALLOWED_EVIDENCE_KINDS = new Set([
  'implementation',
  'test',
  'workflow',
  'documentation',
]);
const ALLOWED_EVIDENCE_MODES = new Set(['exists', 'contains', 'not_contains']);
const TRUSTED_AUTHOR_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
]);

function failManifest(detail = '') {
  throw new Error(`Invalid capability manifest${detail ? `: ${detail}` : ''}`);
}

function failPolicy(detail = '') {
  throw new Error(
    `Invalid commercial readiness policy${detail ? `: ${detail}` : ''}`,
  );
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(value, fail, label) {
  if (typeof value !== 'string' || !value.trim()) fail(label);
  return value.trim();
}

function score(value, fail, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 5) fail(label);
  return value;
}

function positiveIssueOrNull(value) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value) || value <= 0)
    failManifest('invalid tracking issue');
  return value;
}

function validateRelativePath(value) {
  const path = requiredString(value, failManifest, 'invalid evidence path');
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((segment) => segment === '..' || segment === '.') ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    failManifest('invalid evidence path');
  }
  return path;
}

function isDocumentationPath(path) {
  return (
    [
      'README.md',
      'SECURITY.md',
      'LICENSE',
      'CONTRIBUTING.md',
      'CODE_OF_CONDUCT.md',
      'PRIVACY.md',
      'TERMS.md',
    ].includes(path) || path.startsWith('docs/')
  );
}

function isTestPath(path) {
  return (
    path.startsWith('tests/') ||
    path.includes('/tests/') ||
    /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(path)
  );
}

function validateEvidence(value) {
  if (!isPlainObject(value)) failManifest('invalid evidence');
  const maturity = requiredString(
    value.maturity,
    failManifest,
    'invalid evidence maturity',
  );
  if (maturity === 'missing' || !(maturity in MATURITY_RANK)) {
    failManifest('invalid evidence maturity');
  }
  const kind = requiredString(
    value.kind,
    failManifest,
    'invalid evidence kind',
  );
  if (!ALLOWED_EVIDENCE_KINDS.has(kind)) failManifest('invalid evidence kind');
  const mode = requiredString(
    value.mode,
    failManifest,
    'invalid evidence mode',
  );
  if (!ALLOWED_EVIDENCE_MODES.has(mode)) failManifest('invalid evidence mode');
  const path = validateRelativePath(value.path);

  if (
    (kind === 'implementation' || kind === 'test' || kind === 'workflow') &&
    isDocumentationPath(path)
  ) {
    failManifest('evidence path does not match evidence kind');
  }
  if (kind === 'documentation' && !isDocumentationPath(path)) {
    failManifest('evidence path does not match evidence kind');
  }
  if (kind === 'test' && !isTestPath(path)) {
    failManifest('evidence path does not match evidence kind');
  }
  if (kind === 'workflow' && !path.startsWith('.github/workflows/')) {
    failManifest('evidence path does not match evidence kind');
  }

  let probeValue;
  if (mode === 'contains' || mode === 'not_contains') {
    probeValue = requiredString(
      value.value,
      failManifest,
      'invalid evidence probe',
    );
    if (probeValue.length > 512) failManifest('invalid evidence probe');
  } else if (value.value !== undefined) {
    failManifest('invalid evidence probe');
  }

  const maxBytes = value.max_bytes ?? 512 * 1024;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 1024 * 1024
  ) {
    failManifest('invalid evidence byte limit');
  }

  return Object.freeze({
    maturity,
    kind,
    mode,
    path,
    ...(probeValue === undefined ? {} : { value: probeValue }),
    max_bytes: maxBytes,
  });
}

function detectDependencyProblems(capabilities) {
  const ids = new Set(capabilities.map((item) => item.id));
  for (const capability of capabilities) {
    for (const dependency of capability.dependencies) {
      if (!ids.has(dependency))
        failManifest(`unknown dependency ${dependency}`);
    }
  }

  const state = new Map();
  function visit(id, chain) {
    const current = state.get(id);
    if (current === 'visiting') {
      failManifest(`dependency cycle detected: ${[...chain, id].join(' -> ')}`);
    }
    if (current === 'visited') return;
    state.set(id, 'visiting');
    const capability = capabilities.find((item) => item.id === id);
    for (const dependency of capability.dependencies)
      visit(dependency, [...chain, id]);
    state.set(id, 'visited');
  }
  for (const capability of capabilities) visit(capability.id, []);
}

export function validateCapabilityManifest(value) {
  if (
    !isPlainObject(value) ||
    value.schema !== MANIFEST_SCHEMA ||
    !Array.isArray(value.capabilities)
  ) {
    failManifest();
  }
  if (value.capabilities.length === 0 || value.capabilities.length > 100)
    failManifest();

  const seen = new Set();
  const capabilities = value.capabilities.map((entry) => {
    if (!isPlainObject(entry)) failManifest();
    const id = requiredString(entry.id, failManifest, 'invalid capability id');
    if (!CAPABILITY_ID_PATTERN.test(id) || seen.has(id)) {
      failManifest('invalid or duplicate capability id');
    }
    seen.add(id);
    const outcome = requiredString(
      entry.outcome,
      failManifest,
      'invalid outcome',
    );
    if (outcome.length > 300) failManifest('invalid outcome');
    const targetMaturity = requiredString(
      entry.target_maturity,
      failManifest,
      'invalid target maturity',
    );
    if (!(targetMaturity in MATURITY_RANK) || targetMaturity === 'missing') {
      failManifest('invalid target maturity');
    }
    if (!Array.isArray(entry.dependencies) || entry.dependencies.length > 25)
      failManifest();
    const dependencies = entry.dependencies.map((dependency) => {
      const normalized = requiredString(
        dependency,
        failManifest,
        'invalid dependency',
      );
      if (!CAPABILITY_ID_PATTERN.test(normalized) || normalized === id) {
        failManifest('invalid dependency');
      }
      return normalized;
    });
    if (new Set(dependencies).size !== dependencies.length) {
      failManifest('duplicate dependency');
    }
    if (
      !Array.isArray(entry.evidence) ||
      entry.evidence.length === 0 ||
      entry.evidence.length > 50
    ) {
      failManifest('invalid evidence collection');
    }
    const evidence = entry.evidence.map(validateEvidence);
    return Object.freeze({
      id,
      outcome,
      target_maturity: targetMaturity,
      customer_impact: score(
        entry.customer_impact,
        failManifest,
        'invalid customer impact',
      ),
      risk: score(entry.risk, failManifest, 'invalid risk'),
      acquisition_impact: score(
        entry.acquisition_impact,
        failManifest,
        'invalid acquisition impact',
      ),
      effort: score(entry.effort, failManifest, 'invalid effort'),
      dependencies: Object.freeze(dependencies),
      tracking_issue: positiveIssueOrNull(entry.tracking_issue),
      evidence: Object.freeze(evidence),
    });
  });

  detectDependencyProblems(capabilities);
  return Object.freeze({
    schema: MANIFEST_SCHEMA,
    capabilities: Object.freeze(capabilities),
  });
}

function uniqueStrings(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 25)
    failPolicy(label);
  const values = value.map((item) => requiredString(item, failPolicy, label));
  if (new Set(values).size !== values.length) failPolicy(label);
  return values;
}

export function validateCommercialReadinessPolicy(value) {
  if (!isPlainObject(value) || value.schema !== POLICY_SCHEMA) failPolicy();
  const defaultBranch = requiredString(
    value.default_branch,
    failPolicy,
    'invalid default branch',
  );
  if (
    !/^[A-Za-z0-9._/-]{1,100}$/.test(defaultBranch) ||
    defaultBranch.includes('..')
  ) {
    failPolicy();
  }
  const marker = requiredString(
    value.readiness_issue_marker,
    failPolicy,
    'invalid readiness issue marker',
  );
  if (!/^<!--[\x20-\x7e]{8,200}-->$/.test(marker)) failPolicy();
  const title = requiredString(
    value.readiness_issue_title,
    failPolicy,
    'invalid readiness issue title',
  );
  if (title.length > 120) failPolicy();
  const associations = uniqueStrings(
    value.trusted_author_associations,
    'invalid author associations',
  );
  if (
    associations.some(
      (association) => !TRUSTED_AUTHOR_ASSOCIATIONS.has(association),
    )
  ) {
    failPolicy();
  }
  const workflows = uniqueStrings(
    value.required_workflows,
    'invalid required workflows',
  );
  for (const required of REQUIRED_SECURITY_WORKFLOWS) {
    if (!workflows.includes(required))
      failPolicy(`required workflow missing: ${required}`);
  }
  const statuses = uniqueStrings(
    value.required_statuses,
    'invalid required statuses',
  );
  for (const required of REQUIRED_COMMIT_STATUSES) {
    if (!statuses.includes(required))
      failPolicy(`required status missing: ${required}`);
  }
  const retention = value.artifact_retention_days;
  if (!Number.isSafeInteger(retention) || retention < 1 || retention > 7) {
    failPolicy('invalid artifact retention');
  }
  if (value.merge_method !== 'squash')
    failPolicy('merge method must be squash');

  return Object.freeze({
    schema: POLICY_SCHEMA,
    default_branch: defaultBranch,
    readiness_issue_marker: marker,
    readiness_issue_title: title,
    trusted_author_associations: Object.freeze(associations),
    required_workflows: Object.freeze(workflows),
    required_statuses: Object.freeze(statuses),
    artifact_retention_days: retention,
    merge_method: 'squash',
  });
}

const SNAPSHOT_SCHEMA = 'life-os.github-snapshot.v1';
const SNAPSHOT_REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SNAPSHOT_SHA_PATTERN = /^[0-9a-f]{40}$/i;

function failSnapshot(detail = '') {
  throw new Error(`Invalid GitHub snapshot${detail ? `: ${detail}` : ''}`);
}

function exactKeys(value, allowed) {
  if (!isPlainObject(value)) return false;
  return Object.keys(value).every((key) => allowed.has(key));
}

function snapshotString(value, label, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    failSnapshot(label);
  if (/[\u0000-\u001f\u007f]/.test(value)) failSnapshot(label);
  return value;
}

function snapshotExternalNumber(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) failSnapshot(label);
  return value;
}

function validateSnapshotReview(value) {
  const allowed = new Set(['actor', 'state', 'submitted_at']);
  if (!exactKeys(value, allowed)) failSnapshot('invalid review');
  const submittedAt = value.submitted_at;
  if (submittedAt !== null && !Number.isFinite(Date.parse(submittedAt))) {
    failSnapshot('invalid review timestamp');
  }
  return Object.freeze({
    actor: snapshotString(value.actor, 'invalid review actor', 100),
    state: snapshotString(value.state, 'invalid review state', 50),
    submitted_at: submittedAt,
  });
}

function validateSnapshotWorkflow(value) {
  const allowed = new Set([
    'name',
    'status',
    'conclusion',
    'head_sha',
    'run_attempt',
    'updated_at',
  ]);
  if (!exactKeys(value, allowed)) failSnapshot('invalid workflow');
  const conclusion = value.conclusion;
  if (conclusion !== null && typeof conclusion !== 'string')
    failSnapshot('invalid workflow');
  const updatedAt = value.updated_at;
  if (updatedAt !== null && !Number.isFinite(Date.parse(updatedAt))) {
    failSnapshot('invalid workflow');
  }
  if (!Number.isSafeInteger(value.run_attempt) || value.run_attempt < 0) {
    failSnapshot('invalid workflow');
  }
  return Object.freeze({
    name: snapshotString(value.name, 'invalid workflow name', 150),
    status: snapshotString(value.status, 'invalid workflow status', 50),
    conclusion,
    head_sha: (() => {
      const sha = snapshotString(value.head_sha, 'invalid workflow head', 40);
      if (!SNAPSHOT_SHA_PATTERN.test(sha))
        failSnapshot('invalid workflow head');
      return sha.toLowerCase();
    })(),
    run_attempt: value.run_attempt,
    updated_at: updatedAt,
  });
}

function validateSnapshotStatus(value) {
  const allowed = new Set(['context', 'state', 'sha']);
  if (!exactKeys(value, allowed)) failSnapshot('invalid status');
  const sha = snapshotString(value.sha, 'invalid status SHA', 40);
  if (!SNAPSHOT_SHA_PATTERN.test(sha)) failSnapshot('invalid status SHA');
  return Object.freeze({
    context: snapshotString(value.context, 'invalid status context', 150),
    state: snapshotString(value.state, 'invalid status state', 50),
    sha: sha.toLowerCase(),
  });
}

function validateSnapshotPullRequest(value) {
  const allowed = new Set([
    'number',
    'title',
    'state',
    'draft',
    'mergeable',
    'mergeable_state',
    'base_ref',
    'head_sha',
    'head_repo',
    'repository',
    'author_association',
    'behind_by',
    'reviews',
    'unresolved_threads',
    'workflows',
    'statuses',
    'eligible',
    'blockers',
  ]);
  if (!exactKeys(value, allowed)) failSnapshot('invalid pull request');
  if (
    typeof value.draft !== 'boolean' ||
    typeof value.mergeable !== 'boolean'
  ) {
    failSnapshot('invalid pull request flags');
  }
  if (!Number.isSafeInteger(value.behind_by) || value.behind_by < -1) {
    failSnapshot('invalid pull request distance');
  }
  if (
    !Number.isSafeInteger(value.unresolved_threads) ||
    value.unresolved_threads < 0
  ) {
    failSnapshot('invalid review thread count');
  }
  if (typeof value.eligible !== 'boolean')
    failSnapshot('invalid merge eligibility');
  if (!Array.isArray(value.reviews) || value.reviews.length > 100) {
    failSnapshot('invalid reviews');
  }
  if (!Array.isArray(value.workflows) || value.workflows.length > 100) {
    failSnapshot('invalid workflows');
  }
  if (!Array.isArray(value.statuses) || value.statuses.length > 100) {
    failSnapshot('invalid statuses');
  }
  if (!Array.isArray(value.blockers) || value.blockers.length > 100) {
    failSnapshot('invalid blockers');
  }
  const headSha = snapshotString(
    value.head_sha,
    'invalid pull request head',
    40,
  );
  if (!SNAPSHOT_SHA_PATTERN.test(headSha))
    failSnapshot('invalid pull request head');
  const repository = snapshotString(
    value.repository,
    'invalid pull request repository',
    200,
  );
  const headRepo = snapshotString(
    value.head_repo,
    'invalid pull request repository',
    200,
  );
  if (
    !SNAPSHOT_REPOSITORY_PATTERN.test(repository) ||
    !SNAPSHOT_REPOSITORY_PATTERN.test(headRepo)
  ) {
    failSnapshot('invalid pull request repository');
  }
  const blockers = value.blockers.map((item) =>
    snapshotString(item, 'invalid blocker', 200),
  );
  return Object.freeze({
    number: snapshotExternalNumber(value.number, 'invalid pull request number'),
    title: snapshotString(value.title, 'invalid pull request title', 300),
    state: snapshotString(value.state, 'invalid pull request state', 30),
    draft: value.draft,
    mergeable: value.mergeable,
    mergeable_state: snapshotString(
      value.mergeable_state,
      'invalid mergeable state',
      50,
    ),
    base_ref: snapshotString(value.base_ref, 'invalid base ref', 150),
    head_sha: headSha.toLowerCase(),
    head_repo: headRepo,
    repository,
    author_association: snapshotString(
      value.author_association,
      'invalid author association',
      50,
    ),
    behind_by: value.behind_by,
    reviews: Object.freeze(value.reviews.map(validateSnapshotReview)),
    unresolved_threads: value.unresolved_threads,
    workflows: Object.freeze(value.workflows.map(validateSnapshotWorkflow)),
    statuses: Object.freeze(value.statuses.map(validateSnapshotStatus)),
    eligible: value.eligible,
    blockers: Object.freeze(blockers),
  });
}

function validateSnapshotIssue(value) {
  const allowed = new Set(['number', 'title', 'state', 'labels']);
  if (!exactKeys(value, allowed)) failSnapshot('invalid issue');
  if (!Array.isArray(value.labels) || value.labels.length > 50) {
    failSnapshot('invalid issue labels');
  }
  return Object.freeze({
    number: snapshotExternalNumber(value.number, 'invalid issue number'),
    title: snapshotString(value.title, 'invalid issue title', 300),
    state: snapshotString(value.state, 'invalid issue state', 30),
    labels: Object.freeze(
      value.labels.map((label) =>
        snapshotString(label, 'invalid issue label', 100),
      ),
    ),
  });
}

export function validateGitHubSnapshot(value) {
  const allowed = new Set([
    'schema',
    'repository',
    'commit_sha',
    'generated_at',
    'truncated',
    'pull_requests',
    'issues',
  ]);
  if (!exactKeys(value, allowed) || value.schema !== SNAPSHOT_SCHEMA)
    failSnapshot();
  const repository = snapshotString(
    value.repository,
    'invalid repository',
    200,
  );
  if (!SNAPSHOT_REPOSITORY_PATTERN.test(repository))
    failSnapshot('invalid repository');
  const commitSha = snapshotString(value.commit_sha, 'invalid commit SHA', 40);
  if (!SNAPSHOT_SHA_PATTERN.test(commitSha)) failSnapshot('invalid commit SHA');
  if (!Number.isFinite(Date.parse(value.generated_at)))
    failSnapshot('invalid timestamp');
  if (typeof value.truncated !== 'boolean')
    failSnapshot('invalid truncation flag');
  if (!Array.isArray(value.pull_requests) || value.pull_requests.length > 100) {
    failSnapshot('invalid pull requests');
  }
  if (!Array.isArray(value.issues) || value.issues.length > 100) {
    failSnapshot('invalid issues');
  }
  return Object.freeze({
    schema: SNAPSHOT_SCHEMA,
    repository,
    commit_sha: commitSha.toLowerCase(),
    generated_at: new Date(value.generated_at).toISOString(),
    truncated: value.truncated,
    pull_requests: Object.freeze(
      value.pull_requests.map(validateSnapshotPullRequest),
    ),
    issues: Object.freeze(value.issues.map(validateSnapshotIssue)),
  });
}
