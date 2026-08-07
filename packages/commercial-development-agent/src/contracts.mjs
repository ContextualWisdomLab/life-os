const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const ROLE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;
const VALIDATION_NAME_PATTERN = /^[a-z][a-z0-9_]{1,63}$/u;
const MODEL_LABEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SECRET_SHAPED_PATTERN = /^(?:sk-|nvapi-|gh[pousr]_)/iu;
const LIFE_OS_ISSUE_OR_PULL_PATTERN =
  /^https:\/\/github\.com\/ContextualWisdomLab\/life-os\/(issues|pull)\/([1-9]\d*)$/u;

/** Versioned policy schema for deterministic commercial development authority. */
export const COMMERCIAL_DEVELOPMENT_POLICY_SCHEMA =
  'life-os.opencode-commercial-development-policy.v1';

/** Versioned run schema supplied to one bounded OpenCode invocation. */
export const COMMERCIAL_DEVELOPMENT_RUN_SCHEMA =
  'life-os.opencode-commercial-development-run.v1';

/** Versioned credential-free receipt schema retained after one run. */
export const COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA =
  'life-os.opencode-commercial-development-receipt.v1';

const POLICY_KEYS = Object.freeze([
  'schema',
  'eligible_issue_titles',
  'excluded_issue_numbers',
  'allowed_path_prefixes',
  'allowed_root_files',
  'prohibited_path_prefixes',
  'prohibited_exact_paths',
  'maximum_changed_files',
  'maximum_changed_bytes',
  'maximum_changed_lines',
  'maximum_prompt_bytes',
  'maximum_issue_body_bytes',
  'maximum_issue_title_bytes',
  'maximum_open_pull_requests',
  'maximum_open_issues',
  'maximum_opencode_minutes',
  'maximum_workflow_minutes',
  'receipt_retention_days',
  'default_reasoning_effort',
  'maximum_recursive_depth',
  'maximum_decomposition_steps',
  'allowed_roles',
]);

const RUN_KEYS = Object.freeze([
  'schema',
  'run_id',
  'repository',
  'base_sha',
  'started_at',
  'model_label',
  'reasoning_effort',
  'recursive_depth',
  'decomposition_steps',
  'roles',
]);

const ISSUE_KEYS = Object.freeze(['number', 'url', 'title', 'body', 'state']);
const RECEIPT_KEYS = Object.freeze([
  'schema',
  'run_id',
  'repository',
  'base_sha',
  'issue',
  'status',
  'reason_code',
  'opencode_version',
  'model_label',
  'changed_files',
  'changed_bytes',
  'additions',
  'deletions',
  'branch_name',
  'pull_request_url',
  'started_at',
  'completed_at',
  'validations',
]);

const RECEIPT_REASON_CODES = Object.freeze({
  completed: new Set(['completed']),
  unavailable: new Set([
    'no_eligible_issue',
    'provider_credential_missing',
    'provider_unavailable',
    'opencode_unavailable',
  ]),
  rejected: new Set([
    'prompt_rejected',
    'diff_rejected',
    'base_changed',
  ]),
  failed: new Set([
    'invalid_configuration',
    'verification_failed',
    'draft_pull_request_failed',
  ]),
});

/** Stable validation failure that never interpolates rejected input. */
export class CommercialDevelopmentContractError extends Error {
  /** Creates one credential-free contract failure. */
  constructor() {
    super('Commercial development contract is invalid');
    this.name = 'CommercialDevelopmentContractError';
  }
}

/** Throws the stable contract failure. */
function invalid() {
  throw new CommercialDevelopmentContractError();
}

/** Returns whether a value is a non-array record. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires a non-array record. */
function requireRecord(value) {
  return isRecord(value) ? value : invalid();
}

/** Requires one exact set of enumerable keys. */
function requireExactKeys(value, expectedKeys) {
  const expected = new Set(expectedKeys);
  const keys = Object.keys(value);
  if (
    keys.length !== expected.size ||
    keys.some((key) => !expected.has(key))
  ) {
    invalid();
  }
}

/** Recursively freezes one acyclic JSON-compatible contract value. */
function deepFreeze(value) {
  if (Object(value) !== value || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

/** Returns the UTF-8 byte length of a string. */
function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

/** Requires a trimmed bounded control-free string. */
function requireString(
  value,
  { minimumBytes = 1, maximumBytes, pattern, allowEmpty = false } = {},
) {
  if (typeof value !== 'string' || value.trim() !== value) {
    return invalid();
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    return invalid();
  }
  const bytes = byteLength(value);
  if (
    (!allowEmpty && bytes === 0) ||
    bytes < minimumBytes ||
    (maximumBytes !== undefined && bytes > maximumBytes) ||
    (pattern !== undefined && !pattern.test(value))
  ) {
    return invalid();
  }
  return value;
}

/** Requires one bounded safe integer. */
function requireInteger(value, minimum, maximum) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalid();
  }
  return value;
}

/** Requires one canonical ISO-8601 UTC timestamp. */
function requireCanonicalTimestamp(value) {
  const timestamp = requireString(value, { maximumBytes: 64 });
  let canonical;
  try {
    canonical = new Date(timestamp).toISOString();
  } catch {
    return invalid();
  }
  return canonical === timestamp ? timestamp : invalid();
}

/** Requires one unique bounded string array. */
function requireStringArray(
  value,
  { minimumItems = 0, maximumItems = 100, maximumBytes = 1_024, pattern } = {},
) {
  if (
    !Array.isArray(value) ||
    value.length < minimumItems ||
    value.length > maximumItems
  ) {
    return invalid();
  }
  const normalized = value.map((item) =>
    requireString(item, { maximumBytes, pattern }),
  );
  if (new Set(normalized).size !== normalized.length) {
    return invalid();
  }
  return normalized;
}

/** Requires one safe relative path prefix ending in `/`. */
function requirePathPrefix(value) {
  const prefix = requireString(value, { maximumBytes: 512 });
  if (
    !prefix.endsWith('/') ||
    prefix.startsWith('/') ||
    prefix.includes('\\') ||
    prefix.split('/').includes('..')
  ) {
    return invalid();
  }
  return prefix;
}

/** Requires one root-level file name without path traversal. */
function requireRootFile(value) {
  const path = requireString(value, { maximumBytes: 255 });
  if (
    path.includes('/') ||
    path.includes('\\') ||
    path === '.' ||
    path === '..'
  ) {
    return invalid();
  }
  return path;
}

/** Requires one exact LifeOS issue or pull-request URL. */
function requireLifeOsReferenceUrl(value, expectedKind, expectedNumber) {
  const url = requireString(value, { maximumBytes: 512 });
  const match = LIFE_OS_ISSUE_OR_PULL_PATTERN.exec(url);
  if (
    match === null ||
    match[1] !== expectedKind ||
    Number(match[2]) !== expectedNumber
  ) {
    return invalid();
  }
  return url;
}

/** Rejects secret-shaped labels before they can enter retained evidence. */
function requireOpaqueLabel(value, maximumBytes) {
  const label = requireString(value, {
    maximumBytes,
    pattern: MODEL_LABEL_PATTERN,
  });
  if (SECRET_SHAPED_PATTERN.test(label)) {
    return invalid();
  }
  return label;
}

/** Normalizes and deeply freezes the repository-owned development policy. */
export function normalizeCommercialDevelopmentPolicy(value) {
  const input = requireRecord(value);
  requireExactKeys(input, POLICY_KEYS);
  if (input.schema !== COMMERCIAL_DEVELOPMENT_POLICY_SCHEMA) {
    return invalid();
  }

  const maximumIssueTitleBytes = requireInteger(
    input.maximum_issue_title_bytes,
    64,
    4_096,
  );
  const maximumIssueBodyBytes = requireInteger(
    input.maximum_issue_body_bytes,
    2_048,
    65_536,
  );
  const maximumPromptBytes = requireInteger(
    input.maximum_prompt_bytes,
    2_048,
    131_072,
  );
  const maximumOpenCodeMinutes = requireInteger(
    input.maximum_opencode_minutes,
    1,
    180,
  );
  const maximumWorkflowMinutes = requireInteger(
    input.maximum_workflow_minutes,
    maximumOpenCodeMinutes,
    240,
  );

  const eligibleIssueTitles = requireStringArray(input.eligible_issue_titles, {
    minimumItems: 1,
    maximumItems: 50,
    maximumBytes: maximumIssueTitleBytes,
  });
  const excludedIssueNumbers = Array.isArray(input.excluded_issue_numbers)
    ? input.excluded_issue_numbers.map((item) => requireInteger(item, 1, 1_000_000_000))
    : invalid();
  if (new Set(excludedIssueNumbers).size !== excludedIssueNumbers.length) {
    return invalid();
  }

  const allowedPathPrefixes = Array.isArray(input.allowed_path_prefixes)
    ? input.allowed_path_prefixes.map(requirePathPrefix)
    : invalid();
  const prohibitedPathPrefixes = Array.isArray(input.prohibited_path_prefixes)
    ? input.prohibited_path_prefixes.map(requirePathPrefix)
    : invalid();
  if (
    allowedPathPrefixes.length === 0 ||
    prohibitedPathPrefixes.length === 0 ||
    new Set(allowedPathPrefixes).size !== allowedPathPrefixes.length ||
    new Set(prohibitedPathPrefixes).size !== prohibitedPathPrefixes.length
  ) {
    return invalid();
  }

  const allowedRootFiles = Array.isArray(input.allowed_root_files)
    ? input.allowed_root_files.map(requireRootFile)
    : invalid();
  const prohibitedExactPaths = Array.isArray(input.prohibited_exact_paths)
    ? input.prohibited_exact_paths.map(requireRootFile)
    : invalid();
  if (
    allowedRootFiles.length === 0 ||
    prohibitedExactPaths.length === 0 ||
    new Set(allowedRootFiles).size !== allowedRootFiles.length ||
    new Set(prohibitedExactPaths).size !== prohibitedExactPaths.length
  ) {
    return invalid();
  }

  const allowedRoles = requireStringArray(input.allowed_roles, {
    minimumItems: 1,
    maximumItems: 16,
    maximumBytes: 64,
    pattern: ROLE_PATTERN,
  });
  const reasoningEffort = requireString(input.default_reasoning_effort, {
    maximumBytes: 16,
  });
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    return invalid();
  }

  return deepFreeze({
    schema: COMMERCIAL_DEVELOPMENT_POLICY_SCHEMA,
    eligible_issue_titles: eligibleIssueTitles,
    excluded_issue_numbers: excludedIssueNumbers,
    allowed_path_prefixes: allowedPathPrefixes,
    allowed_root_files: allowedRootFiles,
    prohibited_path_prefixes: prohibitedPathPrefixes,
    prohibited_exact_paths: prohibitedExactPaths,
    maximum_changed_files: requireInteger(
      input.maximum_changed_files,
      1,
      100,
    ),
    maximum_changed_bytes: requireInteger(
      input.maximum_changed_bytes,
      2_048,
      10_485_760,
    ),
    maximum_changed_lines: requireInteger(
      input.maximum_changed_lines,
      1,
      100_000,
    ),
    maximum_prompt_bytes: maximumPromptBytes,
    maximum_issue_body_bytes: maximumIssueBodyBytes,
    maximum_issue_title_bytes: maximumIssueTitleBytes,
    maximum_open_pull_requests: requireInteger(
      input.maximum_open_pull_requests,
      1,
      1_000,
    ),
    maximum_open_issues: requireInteger(
      input.maximum_open_issues,
      1,
      1_000,
    ),
    maximum_opencode_minutes: maximumOpenCodeMinutes,
    maximum_workflow_minutes: maximumWorkflowMinutes,
    receipt_retention_days: requireInteger(
      input.receipt_retention_days,
      1,
      90,
    ),
    default_reasoning_effort: reasoningEffort,
    maximum_recursive_depth: requireInteger(
      input.maximum_recursive_depth,
      0,
      8,
    ),
    maximum_decomposition_steps: requireInteger(
      input.maximum_decomposition_steps,
      1,
      64,
    ),
    allowed_roles: allowedRoles,
  });
}

/** Validates and freezes one deterministic OpenCode run context. */
export function validateCommercialDevelopmentRun(value, policyValue) {
  const policy = normalizeCommercialDevelopmentPolicy(policyValue);
  const input = requireRecord(value);
  requireExactKeys(input, RUN_KEYS);
  if (input.schema !== COMMERCIAL_DEVELOPMENT_RUN_SCHEMA) {
    return invalid();
  }
  const roles = requireStringArray(input.roles, {
    minimumItems: 1,
    maximumItems: policy.allowed_roles.length,
    maximumBytes: 64,
    pattern: ROLE_PATTERN,
  });
  if (roles.some((role) => !policy.allowed_roles.includes(role))) {
    return invalid();
  }
  const reasoningEffort = requireString(input.reasoning_effort, {
    maximumBytes: 16,
  });
  if (!['low', 'medium', 'high'].includes(reasoningEffort)) {
    return invalid();
  }
  return deepFreeze({
    schema: COMMERCIAL_DEVELOPMENT_RUN_SCHEMA,
    run_id: requireString(input.run_id, {
      maximumBytes: 36,
      pattern: UUID_V4_PATTERN,
    }),
    repository: requireString(input.repository, {
      maximumBytes: 255,
      pattern: REPOSITORY_PATTERN,
    }),
    base_sha: requireString(input.base_sha, {
      maximumBytes: 40,
      pattern: COMMIT_SHA_PATTERN,
    }),
    started_at: requireCanonicalTimestamp(input.started_at),
    model_label: requireOpaqueLabel(input.model_label, 200),
    reasoning_effort: reasoningEffort,
    recursive_depth: requireInteger(
      input.recursive_depth,
      0,
      policy.maximum_recursive_depth,
    ),
    decomposition_steps: requireInteger(
      input.decomposition_steps,
      1,
      policy.maximum_decomposition_steps,
    ),
    roles,
  });
}

/** Validates and freezes one bounded open LifeOS issue projection. */
export function validateCommercialDevelopmentIssue(value, policyValue) {
  const policy = normalizeCommercialDevelopmentPolicy(policyValue);
  const input = requireRecord(value);
  requireExactKeys(input, ISSUE_KEYS);
  const number = requireInteger(input.number, 1, 1_000_000_000);
  if (input.state !== 'open') {
    return invalid();
  }
  return deepFreeze({
    number,
    url: requireLifeOsReferenceUrl(input.url, 'issues', number),
    title: requireString(input.title, {
      maximumBytes: policy.maximum_issue_title_bytes,
    }),
    body: requireString(input.body, {
      maximumBytes: policy.maximum_issue_body_bytes,
      allowEmpty: true,
      minimumBytes: 0,
    }),
    state: 'open',
  });
}

/** Validates and deeply freezes one credential-free execution receipt. */
export function validateCommercialDevelopmentReceipt(value) {
  const input = requireRecord(value);
  requireExactKeys(input, RECEIPT_KEYS);
  if (input.schema !== COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA) {
    return invalid();
  }
  const status = requireString(input.status, { maximumBytes: 32 });
  const reasonCode = requireString(input.reason_code, {
    maximumBytes: 64,
    pattern: VALIDATION_NAME_PATTERN,
  });
  if (
    !(status in RECEIPT_REASON_CODES) ||
    !RECEIPT_REASON_CODES[status].has(reasonCode)
  ) {
    return invalid();
  }
  const startedAt = requireCanonicalTimestamp(input.started_at);
  const completedAt = requireCanonicalTimestamp(input.completed_at);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    return invalid();
  }
  let issue = null;
  if (input.issue !== null) {
    const issueInput = requireRecord(input.issue);
    requireExactKeys(issueInput, ['number', 'url']);
    const issueNumber = requireInteger(issueInput.number, 1, 1_000_000_000);
    issue = {
      number: issueNumber,
      url: requireLifeOsReferenceUrl(issueInput.url, 'issues', issueNumber),
    };
  }
  const validations = Array.isArray(input.validations)
    ? input.validations.map((item) => {
        const validation = requireRecord(item);
        requireExactKeys(validation, ['name', 'status']);
        const validationStatus = requireString(validation.status, {
          maximumBytes: 16,
        });
        if (!['passed', 'failed', 'skipped'].includes(validationStatus)) {
          return invalid();
        }
        return {
          name: requireString(validation.name, {
            maximumBytes: 64,
            pattern: VALIDATION_NAME_PATTERN,
          }),
          status: validationStatus,
        };
      })
    : invalid();
  if (
    validations.length === 0 ||
    validations.length > 20 ||
    new Set(validations.map((item) => item.name)).size !== validations.length
  ) {
    return invalid();
  }

  let branchName = null;
  if (input.branch_name !== null) {
    const expectedPrefix = 'automation/opencode-commercial-';
    const branch = requireString(input.branch_name, { maximumBytes: 128 });
    if (
      !branch.startsWith(expectedPrefix) ||
      !UUID_V4_PATTERN.test(branch.slice(expectedPrefix.length))
    ) {
      return invalid();
    }
    branchName = branch;
  }
  let pullRequestUrl = null;
  if (input.pull_request_url !== null) {
    const pullUrl = requireString(input.pull_request_url, { maximumBytes: 512 });
    const match = LIFE_OS_ISSUE_OR_PULL_PATTERN.exec(pullUrl);
    if (match === null || match[1] !== 'pull') {
      return invalid();
    }
    pullRequestUrl = pullUrl;
  }
  if (
    status === 'completed' &&
    (issue === null || branchName === null || pullRequestUrl === null)
  ) {
    return invalid();
  }

  return deepFreeze({
    schema: COMMERCIAL_DEVELOPMENT_RECEIPT_SCHEMA,
    run_id: requireString(input.run_id, {
      maximumBytes: 36,
      pattern: UUID_V4_PATTERN,
    }),
    repository: requireString(input.repository, {
      maximumBytes: 255,
      pattern: REPOSITORY_PATTERN,
    }),
    base_sha: requireString(input.base_sha, {
      maximumBytes: 40,
      pattern: COMMIT_SHA_PATTERN,
    }),
    issue,
    status,
    reason_code: reasonCode,
    opencode_version: requireString(input.opencode_version, {
      maximumBytes: 128,
    }),
    model_label: requireOpaqueLabel(input.model_label, 200),
    changed_files: requireInteger(input.changed_files, 0, 100_000),
    changed_bytes: requireInteger(input.changed_bytes, 0, 1_000_000_000),
    additions: requireInteger(input.additions, 0, 1_000_000_000),
    deletions: requireInteger(input.deletions, 0, 1_000_000_000),
    branch_name: branchName,
    pull_request_url: pullRequestUrl,
    started_at: startedAt,
    completed_at: completedAt,
    validations,
  });
}
