import { posix as pathPosix } from 'node:path';
import {
  CommercialDevelopmentContractError,
  normalizeCommercialDevelopmentPolicy,
} from './contracts.mjs';

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;
const CONTROL_NUL_PATTERN = /\u0000/u;
const DEPENDENCY_FILE_NAMES = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'pyproject.toml',
  'poetry.lock',
  'requirements.txt',
  'requirements.lock',
  'Pipfile',
  'Pipfile.lock',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'Gemfile',
  'Gemfile.lock',
]);
const DOCUMENTATION_EXTENSIONS = new Set([
  '.md',
  '.mdx',
  '.txt',
  '.rst',
  '.adoc',
]);
const SECRET_PATTERNS = Object.freeze([
  /COPILOT_GITHUB_TOKEN/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/u,
  /\bnvapi-[A-Za-z0-9_-]{20,}\b/u,
  /\bsk-[A-Za-z0-9_-]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
]);
const PRIVILEGED_EXECUTABLE_PATTERNS = Object.freeze([
  /\bgit\s+push\b[^\n]*\s--force(?:-with-lease)?\b/iu,
  /\bgh\s+pr\s+merge\b[^\n]*\s--admin\b/iu,
  /\bgh\s+release\s+(?:create|delete|upload)\b/iu,
  /\bgh\s+api\b[^\n]*(?:actions\/secrets|actions\/variables|branches\/[^\s/]+\/protection|\/releases|\/environments)/iu,
  /\bgit\s+tag\b/iu,
  /\bDROP\s+(?:DATABASE|SCHEMA)\b/iu,
  /\bTRUNCATE\s+TABLE\b/iu,
  /\brm\s+-rf\s+\/(?:\s|$)/u,
  /\bcurl\b[^\n|]*\|\s*(?:bash|sh)\b/iu,
]);
const EVIDENCE_KEYS = Object.freeze(['base_sha', 'current_base_sha', 'files']);
const FILE_KEYS = Object.freeze([
  'path',
  'status',
  'bytes',
  'additions',
  'deletions',
  'binary',
  'symlink',
  'submodule',
  'content',
]);

/** Stable malformed-evidence failure that never retains source text. */
export class CommercialDevelopmentDiffError extends Error {
  /** Creates one credential-free diff evidence failure. */
  constructor() {
    super('Commercial development diff evidence is invalid');
    this.name = 'CommercialDevelopmentDiffError';
  }
}

/** Throws the stable malformed-evidence failure. */
function invalid() {
  throw new CommercialDevelopmentDiffError();
}

/** Returns whether a value is a non-array record. */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Requires one exact object key set. */
function requireExactKeys(value, expectedKeys) {
  const expected = new Set(expectedKeys);
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    invalid();
  }
}

/** Requires one bounded safe integer. */
function requireInteger(value, minimum = 0, maximum = 1_000_000_000) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    return invalid();
  }
  return value;
}

/** Requires one lowercase full commit SHA. */
function requireCommitSha(value) {
  return typeof value === 'string' && COMMIT_SHA_PATTERN.test(value)
    ? value
    : invalid();
}

/** Requires one normalized relative POSIX repository path. */
function requireRepositoryPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > 1_024 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    CONTROL_NUL_PATTERN.test(value) ||
    pathPosix.normalize(value) !== value ||
    value.split('/').includes('..')
  ) {
    return invalid();
  }
  return value;
}

/** Returns whether the path belongs to the initial safe write surface. */
function isAllowedPath(path, policy) {
  if (
    policy.prohibited_exact_paths.includes(path) ||
    policy.prohibited_path_prefixes.some((prefix) => path.startsWith(prefix))
  ) {
    return false;
  }
  const basename = pathPosix.basename(path);
  if (DEPENDENCY_FILE_NAMES.has(basename)) {
    return false;
  }
  return (
    policy.allowed_root_files.includes(path) ||
    policy.allowed_path_prefixes.some((prefix) => path.startsWith(prefix))
  );
}

/** Returns whether source content is documentation rather than executable code. */
function isDocumentationPath(path) {
  return DOCUMENTATION_EXTENSIONS.has(pathPosix.extname(path).toLowerCase());
}

/** Returns whether one source file contains prohibited content. */
function containsProhibitedContent(path, content) {
  if (SECRET_PATTERNS.some((pattern) => pattern.test(content))) {
    return true;
  }
  return (
    !isDocumentationPath(path) &&
    PRIVILEGED_EXECUTABLE_PATTERNS.some((pattern) => pattern.test(content))
  );
}

/** Returns a frozen rejection or acceptance summary without source paths. */
function result(accepted, reasonCode, counts) {
  return Object.freeze({
    accepted,
    reason_code: reasonCode,
    changed_files: counts.changedFiles,
    changed_bytes: counts.changedBytes,
    additions: counts.additions,
    deletions: counts.deletions,
  });
}

/**
 * Validates a projected working-tree diff before any remote branch is pushed.
 * Malformed evidence throws; valid but unauthorized changes return a stable
 * rejected result.
 */
export function validateCommercialDevelopmentDiff(value, policyValue) {
  try {
    const policy = normalizeCommercialDevelopmentPolicy(policyValue);
    if (!isRecord(value)) {
      return invalid();
    }
    requireExactKeys(value, EVIDENCE_KEYS);
    const baseSha = requireCommitSha(value.base_sha);
    const currentBaseSha = requireCommitSha(value.current_base_sha);
    if (!Array.isArray(value.files) || value.files.length > 100_000) {
      return invalid();
    }
    const files = value.files.map((item) => {
      if (!isRecord(item)) {
        return invalid();
      }
      requireExactKeys(item, FILE_KEYS);
      const path = requireRepositoryPath(item.path);
      if (!['A', 'M', 'D', 'R'].includes(item.status)) {
        return invalid();
      }
      const bytes = requireInteger(item.bytes);
      const additions = requireInteger(item.additions);
      const deletions = requireInteger(item.deletions);
      if (
        typeof item.binary !== 'boolean' ||
        typeof item.symlink !== 'boolean' ||
        typeof item.submodule !== 'boolean' ||
        typeof item.content !== 'string' ||
        CONTROL_NUL_PATTERN.test(item.content) ||
        Buffer.byteLength(item.content, 'utf8') > bytes ||
        (item.status === 'A' && deletions !== 0) ||
        (item.status === 'D' &&
          (bytes !== 0 || additions !== 0 || item.content !== ''))
      ) {
        return invalid();
      }
      return Object.freeze({
        path,
        status: item.status,
        bytes,
        additions,
        deletions,
        binary: item.binary,
        symlink: item.symlink,
        submodule: item.submodule,
        content: item.content,
      });
    });
    const counts = {
      changedFiles: files.length,
      changedBytes: files.reduce((sum, item) => sum + item.bytes, 0),
      additions: files.reduce((sum, item) => sum + item.additions, 0),
      deletions: files.reduce((sum, item) => sum + item.deletions, 0),
    };
    if (files.length === 0) {
      return result(false, 'no_change', counts);
    }
    if (currentBaseSha !== baseSha) {
      return result(false, 'base_changed', counts);
    }
    if (
      counts.changedFiles > policy.maximum_changed_files ||
      counts.changedBytes > policy.maximum_changed_bytes ||
      counts.additions + counts.deletions > policy.maximum_changed_lines
    ) {
      return result(false, 'limit_exceeded', counts);
    }
    if (files.some((item) => !isAllowedPath(item.path, policy))) {
      return result(false, 'path_rejected', counts);
    }
    if (
      files.some(
        (item) =>
          item.binary || item.symlink || item.submodule || item.status === 'R',
      )
    ) {
      return result(false, 'object_rejected', counts);
    }
    if (
      files.some((item) => containsProhibitedContent(item.path, item.content))
    ) {
      return result(false, 'content_rejected', counts);
    }
    return result(true, 'accepted', counts);
  } catch (error) {
    if (error instanceof CommercialDevelopmentDiffError) {
      throw error;
    }
    if (error instanceof CommercialDevelopmentContractError) {
      return invalid();
    }
    return invalid();
  }
}
