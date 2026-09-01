const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const RC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/u;
const NIGHTLY_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.[0-9A-Za-z][0-9A-Za-z.-]*$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAX_IDENTIFIER_LENGTH = 128;
const MAX_COMMAND_LENGTH = 2048;
const MAX_ARTIFACTS = 256;
const MAX_VERIFICATIONS = 256;
const MAX_ARTIFACT_REFERENCES = 64;
const MAX_OPEN_P0_ISSUES = 100;

const RELEASE_CHANNELS = new Set(['nightly', 'rc', 'stable']);
const ARTIFACT_KINDS = new Set([
  'oci-image',
  'migration-bundle',
  'spdx-sbom',
  'slsa-provenance',
  'checksum-manifest',
  'signature',
]);
const VERIFICATION_PROFILES = new Set([
  'single-host',
  'kubernetes',
  'upgrade',
  'rollback',
  'backup-restore',
  'accessibility',
  'buyer-journey',
  'api-compatibility',
]);

class ReleaseEvidenceValidationError extends Error {
  constructor() {
    super('release evidence is invalid');
    this.name = 'ReleaseEvidenceValidationError';
  }
}

function invalid() {
  throw new ReleaseEvidenceValidationError();
}

function requireObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid();
  }
  return value;
}

function requireExactKeys(value, required, allowed = required) {
  const keys = Object.keys(value);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.some((key) => !allowed.includes(key))
  ) {
    return invalid();
  }
}

function requireIdentifier(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

function requireSourceCommit(value) {
  if (typeof value !== 'string' || !SOURCE_COMMIT_PATTERN.test(value)) {
    return invalid();
  }
  return value;
}

function requireDigest(value) {
  if (typeof value !== 'string' || !SHA256_DIGEST_PATTERN.test(value)) {
    return invalid();
  }
  return value;
}

function requireInstant(value) {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalid();
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    return invalid();
  }
  return value;
}

function requireVersion(channel, version) {
  if (typeof version !== 'string') {
    return invalid();
  }
  const valid =
    (channel === 'stable' && STABLE_VERSION_PATTERN.test(version)) ||
    (channel === 'rc' && RC_VERSION_PATTERN.test(version)) ||
    (channel === 'nightly' && NIGHTLY_VERSION_PATTERN.test(version));
  if (!valid) {
    return invalid();
  }
  return version;
}

function requireBoundedCommand(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_COMMAND_LENGTH ||
    CONTROL_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

function requireUniqueIssueNumbers(value, required) {
  if (value === undefined && !required) {
    return Object.freeze([]);
  }
  if (
    !Array.isArray(value) ||
    value.length > MAX_OPEN_P0_ISSUES ||
    value.some((issueNumber) => !Number.isSafeInteger(issueNumber) || issueNumber < 1)
  ) {
    return invalid();
  }
  const unique = new Set(value);
  if (unique.size !== value.length) {
    return invalid();
  }
  return Object.freeze([...value].sort((left, right) => left - right));
}

function validateRelease(value, openP0IssueNumbers) {
  const release = requireObject(value);
  requireExactKeys(release, [
    'version',
    'channel',
    'source_commit',
    'generated_at',
  ]);
  if (!RELEASE_CHANNELS.has(release.channel)) {
    return invalid();
  }
  if (release.channel === 'stable' && openP0IssueNumbers.length !== 0) {
    return invalid();
  }
  return Object.freeze({
    version: requireVersion(release.channel, release.version),
    channel: release.channel,
    source_commit: requireSourceCommit(release.source_commit),
    generated_at: requireInstant(release.generated_at),
  });
}

function validateArtifacts(value, sourceCommit) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ARTIFACTS
  ) {
    return invalid();
  }
  const seen = new Set();
  const artifacts = value.map((entry) => {
    const artifact = requireObject(entry);
    requireExactKeys(artifact, [
      'artifact_id',
      'kind',
      'digest',
      'source_commit',
    ]);
    const artifactId = requireIdentifier(artifact.artifact_id);
    if (seen.has(artifactId) || !ARTIFACT_KINDS.has(artifact.kind)) {
      return invalid();
    }
    seen.add(artifactId);
    const artifactSourceCommit = requireSourceCommit(artifact.source_commit);
    if (artifactSourceCommit !== sourceCommit) {
      return invalid();
    }
    return Object.freeze({
      artifact_id: artifactId,
      kind: artifact.kind,
      digest: requireDigest(artifact.digest),
      source_commit: artifactSourceCommit,
    });
  });
  return Object.freeze(artifacts);
}

function validateVerifications(value, artifactIds, generatedAt) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_VERIFICATIONS
  ) {
    return invalid();
  }
  const seen = new Set();
  const generatedAtMillis = new Date(generatedAt).getTime();
  const verifications = value.map((entry) => {
    const verification = requireObject(entry);
    requireExactKeys(verification, [
      'verification_id',
      'artifact_ids',
      'profile',
      'command',
      'result',
      'completed_at',
    ]);
    const verificationId = requireIdentifier(verification.verification_id);
    if (
      seen.has(verificationId) ||
      !VERIFICATION_PROFILES.has(verification.profile) ||
      verification.result !== 'passed' ||
      !Array.isArray(verification.artifact_ids) ||
      verification.artifact_ids.length === 0 ||
      verification.artifact_ids.length > MAX_ARTIFACT_REFERENCES
    ) {
      return invalid();
    }
    seen.add(verificationId);
    const referenced = verification.artifact_ids.map(requireIdentifier);
    if (
      new Set(referenced).size !== referenced.length ||
      referenced.some((artifactId) => !artifactIds.has(artifactId))
    ) {
      return invalid();
    }
    const completedAt = requireInstant(verification.completed_at);
    if (new Date(completedAt).getTime() > generatedAtMillis) {
      return invalid();
    }
    return Object.freeze({
      verification_id: verificationId,
      artifact_ids: Object.freeze([...referenced]),
      profile: verification.profile,
      command: requireBoundedCommand(verification.command),
      result: 'passed',
      completed_at: completedAt,
    });
  });
  return Object.freeze(verifications);
}

/**
 * Validates and freezes one machine-readable release evidence index.
 *
 * The index is accepted only when every verification references immutable
 * SHA-256-addressed artifacts produced from the release's exact source commit.
 * RC and nightly evidence may describe an intentionally incomplete product, while
 * stable evidence must explicitly carry no open P0 issue numbers. The function
 * performs no network or filesystem I/O, does not execute recorded commands, and
 * throws a generic error rather than reflecting untrusted release material.
 *
 * @param {unknown} value untrusted parsed JSON from a release evidence artifact
 * @returns {Readonly<object>} a normalized deeply frozen evidence index
 * @throws {ReleaseEvidenceValidationError} when structure, identity, bounds,
 * provenance, channel/version semantics, or artifact references are invalid
 */
export function validateReleaseEvidenceIndex(value) {
  const index = requireObject(value);
  requireExactKeys(
    index,
    ['schema_version', 'release', 'artifacts', 'verifications'],
    [
      'schema_version',
      'release',
      'artifacts',
      'verifications',
      'open_p0_issue_numbers',
    ],
  );
  if (index.schema_version !== 'life-os.release-evidence.v1') {
    return invalid();
  }
  const releaseCandidate = requireObject(index.release);
  const stableCandidate = releaseCandidate.channel === 'stable';
  const openP0IssueNumbers = requireUniqueIssueNumbers(
    index.open_p0_issue_numbers,
    stableCandidate,
  );
  const release = validateRelease(releaseCandidate, openP0IssueNumbers);
  const artifacts = validateArtifacts(index.artifacts, release.source_commit);
  const artifactIds = new Set(artifacts.map((artifact) => artifact.artifact_id));
  const verifications = validateVerifications(
    index.verifications,
    artifactIds,
    release.generated_at,
  );
  return Object.freeze({
    schema_version: 'life-os.release-evidence.v1',
    release,
    open_p0_issue_numbers: openP0IssueNumbers,
    artifacts,
    verifications,
  });
}
