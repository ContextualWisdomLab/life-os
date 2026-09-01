const RELEASE_SCHEMA_VERSION = 'life-os.release-evidence.v1';
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const RC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/u;
const NIGHTLY_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.\d{8}\.(0|[1-9]\d*)$/u;
const MAXIMUM_P0_GAPS = 64;
const MAXIMUM_ARTIFACTS = 128;
const EVIDENCE_TYPES = new Set([
  'application',
  'container',
  'migration',
  'sbom',
  'provenance',
  'signature',
  'checksum',
  'test-report',
  'recovery-report',
]);

/**
 * Stable validation failure for malformed or overclaimed release evidence.
 *
 * The error intentionally carries no artifact payload so a caller can reject an
 * untrusted release index without copying paths, build output, or external data
 * into logs or public responses.
 */
export class ReleaseEvidenceValidationError extends Error {
  /** Creates the credential- and payload-free validation failure. */
  constructor() {
    super('Release evidence index is invalid');
    this.name = 'ReleaseEvidenceValidationError';
  }
}

function invalid() {
  throw new ReleaseEvidenceValidationError();
}

function requirePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value;
}

function requireExactKeys(record, expected) {
  const keys = Object.keys(record).sort();
  const required = [...expected].sort();
  if (keys.length !== required.length || keys.some((key, index) => key !== required[index])) {
    return invalid();
  }
}

function requireSourceCommit(value) {
  if (typeof value !== 'string' || !SOURCE_COMMIT_PATTERN.test(value)) return invalid();
  return value;
}

function requireGeneratedAt(value) {
  if (typeof value !== 'string') return invalid();
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) return invalid();
  return value;
}

function requireChannel(value) {
  if (value !== 'nightly' && value !== 'rc' && value !== 'stable') return invalid();
  return value;
}

function requireVersion(value, channel) {
  if (typeof value !== 'string') return invalid();
  const pattern =
    channel === 'stable'
      ? STABLE_VERSION_PATTERN
      : channel === 'rc'
        ? RC_VERSION_PATTERN
        : NIGHTLY_VERSION_PATTERN;
  if (!pattern.test(value)) return invalid();
  return value;
}

function requireOpenP0BuyerGaps(value, channel) {
  if (!Array.isArray(value) || value.length > MAXIMUM_P0_GAPS) return invalid();
  const normalized = value.map((issueNumber) => {
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) return invalid();
    return issueNumber;
  });
  for (let index = 0; index < normalized.length; index += 1) {
    if (
      (index > 0 && normalized[index - 1] >= normalized[index]) ||
      (channel === 'stable' && normalized.length > 0)
    ) {
      return invalid();
    }
  }
  return Object.freeze(normalized);
}

function requireArtifactName(value) {
  if (typeof value !== 'string' || !ARTIFACT_NAME_PATTERN.test(value)) return invalid();
  return value;
}

function requireEvidenceType(value) {
  if (typeof value !== 'string' || !EVIDENCE_TYPES.has(value)) return invalid();
  return value;
}

function requireDigest(value) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) return invalid();
  return value;
}

function requireSize(value) {
  if (!Number.isSafeInteger(value) || value <= 0) return invalid();
  return value;
}

function requireStandard(record, evidenceType) {
  const hasStandard = Object.hasOwn(record, 'standard');
  if (evidenceType === 'sbom') {
    if (!hasStandard || record.standard !== 'SPDX-3.0.1') return invalid();
    return record.standard;
  }
  if (evidenceType === 'provenance') {
    if (!hasStandard || record.standard !== 'SLSA-v1.2-provenance') return invalid();
    return record.standard;
  }
  if (hasStandard) return invalid();
  return undefined;
}

function requireArtifact(value, sourceCommit) {
  const record = requirePlainObject(value);
  const evidenceType = requireEvidenceType(record.evidence_type);
  const hasStandard = Object.hasOwn(record, 'standard');
  requireExactKeys(
    record,
    hasStandard
      ? ['artifact_name', 'evidence_type', 'standard', 'sha256', 'size_bytes', 'source_commit']
      : ['artifact_name', 'evidence_type', 'sha256', 'size_bytes', 'source_commit'],
  );
  const artifactSourceCommit = requireSourceCommit(record.source_commit);
  if (artifactSourceCommit !== sourceCommit) return invalid();
  const standard = requireStandard(record, evidenceType);
  const artifact = {
    artifact_name: requireArtifactName(record.artifact_name),
    evidence_type: evidenceType,
    ...(standard === undefined ? {} : { standard }),
    sha256: requireDigest(record.sha256),
    size_bytes: requireSize(record.size_bytes),
    source_commit: artifactSourceCommit,
  };
  return Object.freeze(artifact);
}

function requireArtifacts(value, sourceCommit) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_ARTIFACTS) {
    return invalid();
  }
  const artifacts = value.map((artifact) => requireArtifact(artifact, sourceCommit));
  const names = new Set();
  const evidenceTypes = new Set();
  for (const artifact of artifacts) {
    if (names.has(artifact.artifact_name)) return invalid();
    names.add(artifact.artifact_name);
    evidenceTypes.add(artifact.evidence_type);
  }
  for (const requiredType of ['sbom', 'provenance', 'checksum']) {
    if (!evidenceTypes.has(requiredType)) return invalid();
  }
  return Object.freeze(artifacts);
}

/**
 * Validates one immutable index for release-candidate evidence.
 *
 * The contract binds every retained artifact to one exact source commit, keeps
 * unresolved P0 buyer gaps explicit, and prevents a `stable` channel assertion
 * while any P0 gap remains. SPDX and SLSA labels describe the evidence format
 * expected in the referenced artifact; successful validation does not claim
 * certification, provenance level, accessibility conformance, or release
 * readiness by itself.
 *
 * @param {unknown} value Untrusted machine-readable release evidence.
 * @returns {Readonly<object>} A deeply frozen, bounded release evidence index.
 * @throws {ReleaseEvidenceValidationError} When identity, scope, artifact, or channel evidence is invalid.
 */
export function validateReleaseEvidenceIndex(value) {
  const record = requirePlainObject(value);
  requireExactKeys(record, [
    'schema_version',
    'channel',
    'version',
    'source_commit',
    'generated_at',
    'open_p0_buyer_gaps',
    'artifacts',
  ]);
  if (record.schema_version !== RELEASE_SCHEMA_VERSION) return invalid();
  const channel = requireChannel(record.channel);
  const sourceCommit = requireSourceCommit(record.source_commit);
  return Object.freeze({
    schema_version: RELEASE_SCHEMA_VERSION,
    channel,
    version: requireVersion(record.version, channel),
    source_commit: sourceCommit,
    generated_at: requireGeneratedAt(record.generated_at),
    open_p0_buyer_gaps: requireOpenP0BuyerGaps(record.open_p0_buyer_gaps, channel),
    artifacts: requireArtifacts(record.artifacts, sourceCommit),
  });
}
