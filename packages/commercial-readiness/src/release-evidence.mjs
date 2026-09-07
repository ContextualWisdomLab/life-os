import { createHash } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const RELEASE_SCHEMA_VERSION = 'life-os.release-evidence.v1';
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const RC_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-rc\.(0|[1-9]\d*)$/u;
const NIGHTLY_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-nightly\.(\d{8})\.(0|[1-9]\d*)$/u;
const MAXIMUM_P0_GAPS = 64;
const MAXIMUM_ARTIFACTS = 128;
const VERIFY_BUFFER_BYTES = 64 * 1024;
const SPDX_SPEC_VERSION = '3.0.1';
const SLSA_PROVENANCE_PREDICATE_TYPE = 'https://slsa.dev/provenance/v1';
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
const SIGNATURE_REQUIRED_SUBJECT_TYPES = new Set(['container', 'checksum', 'provenance']);

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

function requireNightlyCalendarDate(dateToken) {
  const year = Number(dateToken.slice(0, 4));
  const month = Number(dateToken.slice(4, 6));
  const day = Number(dateToken.slice(6, 8));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maximumDay = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  if (!maximumDay || day < 1 || day > maximumDay) return invalid();
}

function parseReleaseVersion(value, expectedChannel) {
  if (typeof value !== 'string') return invalid();

  let channel;
  let match = STABLE_VERSION_PATTERN.exec(value);
  let prerelease = [];
  if (match) {
    channel = 'stable';
  } else {
    match = RC_VERSION_PATTERN.exec(value);
    if (match) {
      channel = 'rc';
      prerelease = ['rc', BigInt(match[4])];
    } else {
      match = NIGHTLY_VERSION_PATTERN.exec(value);
      if (!match) return invalid();
      channel = 'nightly';
      requireNightlyCalendarDate(match[4]);
      prerelease = ['nightly', BigInt(match[4]), BigInt(match[5])];
    }
  }

  if (expectedChannel !== undefined && channel !== expectedChannel) return invalid();
  return Object.freeze({
    value,
    channel,
    core: Object.freeze([BigInt(match[1]), BigInt(match[2]), BigInt(match[3])]),
    prerelease: Object.freeze(prerelease),
  });
}

function compareReleaseVersions(left, right) {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] < right.core[index]) return -1;
    if (left.core[index] > right.core[index]) return 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    if (typeof leftPart === 'bigint' && typeof rightPart === 'bigint') {
      return leftPart < rightPart ? -1 : 1;
    }
    if (typeof leftPart === 'bigint') return -1;
    if (typeof rightPart === 'bigint') return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

function requireOpenP0BuyerGaps(value, channel) {
  if (!Array.isArray(value) || value.length > MAXIMUM_P0_GAPS) return invalid();
  const normalized = value.map((issueNumber) => {
    if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) return invalid();
    return issueNumber;
  });
  for (let index = 0; index < normalized.length; index += 1) {
    if (index > 0 && normalized[index - 1] >= normalized[index]) return invalid();
  }
  if (channel === 'stable' && normalized.length > 0) return invalid();
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

function requireFormatEvidence(record, evidenceType) {
  const hasSpecVersion = Object.hasOwn(record, 'spec_version');
  const hasPredicateType = Object.hasOwn(record, 'predicate_type');
  if (evidenceType === 'sbom') {
    if (!hasSpecVersion || hasPredicateType || record.spec_version !== SPDX_SPEC_VERSION) {
      return invalid();
    }
    return Object.freeze({ spec_version: SPDX_SPEC_VERSION });
  }
  if (evidenceType === 'provenance') {
    if (
      hasSpecVersion ||
      !hasPredicateType ||
      record.predicate_type !== SLSA_PROVENANCE_PREDICATE_TYPE
    ) {
      return invalid();
    }
    return Object.freeze({ predicate_type: SLSA_PROVENANCE_PREDICATE_TYPE });
  }
  if (hasSpecVersion || hasPredicateType) return invalid();
  return Object.freeze({});
}

function requireMigrationCompatibility(record, evidenceType, releaseVersion) {
  const hasCompatibility = Object.hasOwn(record, 'compatibility');
  if (evidenceType !== 'migration') {
    if (hasCompatibility) return invalid();
    return Object.freeze({});
  }
  if (!hasCompatibility) return invalid();

  const compatibility = requirePlainObject(record.compatibility);
  requireExactKeys(compatibility, ['minimum_source_version', 'maximum_source_version']);
  const minimum = parseReleaseVersion(compatibility.minimum_source_version);
  const maximum = parseReleaseVersion(compatibility.maximum_source_version);
  if (compareReleaseVersions(minimum, maximum) > 0) return invalid();
  if (compareReleaseVersions(maximum, releaseVersion) >= 0) return invalid();
  return Object.freeze({
    compatibility: Object.freeze({
      minimum_source_version: minimum.value,
      maximum_source_version: maximum.value,
    }),
  });
}

function requireSignatureSubject(record, evidenceType) {
  const hasSubjectArtifactName = Object.hasOwn(record, 'subject_artifact_name');
  const hasSubjectSha256 = Object.hasOwn(record, 'subject_sha256');
  if (evidenceType === 'signature') {
    if (!hasSubjectArtifactName || !hasSubjectSha256) return invalid();
    return Object.freeze({
      subject_artifact_name: requireArtifactName(record.subject_artifact_name),
      subject_sha256: requireDigest(record.subject_sha256),
    });
  }
  if (hasSubjectArtifactName || hasSubjectSha256) return invalid();
  return Object.freeze({});
}

function requireArtifact(value, sourceCommit, releaseVersion) {
  const record = requirePlainObject(value);
  const evidenceType = requireEvidenceType(record.evidence_type);
  const hasSpecVersion = Object.hasOwn(record, 'spec_version');
  const hasPredicateType = Object.hasOwn(record, 'predicate_type');
  const hasCompatibility = Object.hasOwn(record, 'compatibility');
  const hasSubjectArtifactName = Object.hasOwn(record, 'subject_artifact_name');
  const hasSubjectSha256 = Object.hasOwn(record, 'subject_sha256');
  requireExactKeys(record, [
    'artifact_name',
    'evidence_type',
    ...(hasSpecVersion ? ['spec_version'] : []),
    ...(hasPredicateType ? ['predicate_type'] : []),
    ...(hasCompatibility ? ['compatibility'] : []),
    ...(hasSubjectArtifactName ? ['subject_artifact_name'] : []),
    ...(hasSubjectSha256 ? ['subject_sha256'] : []),
    'sha256',
    'size_bytes',
    'source_commit',
  ]);
  const artifactSourceCommit = requireSourceCommit(record.source_commit);
  if (artifactSourceCommit !== sourceCommit) return invalid();
  const formatEvidence = requireFormatEvidence(record, evidenceType);
  const migrationCompatibility = requireMigrationCompatibility(record, evidenceType, releaseVersion);
  const signatureSubject = requireSignatureSubject(record, evidenceType);
  return Object.freeze({
    artifact_name: requireArtifactName(record.artifact_name),
    evidence_type: evidenceType,
    ...formatEvidence,
    ...migrationCompatibility,
    ...signatureSubject,
    sha256: requireDigest(record.sha256),
    size_bytes: requireSize(record.size_bytes),
    source_commit: artifactSourceCommit,
  });
}

function requireArtifacts(value, sourceCommit, releaseVersion) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_ARTIFACTS) {
    return invalid();
  }
  const artifacts = value.map((artifact) => requireArtifact(artifact, sourceCommit, releaseVersion));
  const byName = new Map();
  const evidenceTypes = new Set();
  for (const artifact of artifacts) {
    if (byName.has(artifact.artifact_name)) return invalid();
    byName.set(artifact.artifact_name, artifact);
    evidenceTypes.add(artifact.evidence_type);
  }
  for (const requiredType of [
    'container',
    'migration',
    'sbom',
    'provenance',
    'checksum',
    'signature',
  ]) {
    if (!evidenceTypes.has(requiredType)) return invalid();
  }
  const signedSubjectNames = new Set();
  for (const artifact of artifacts) {
    if (artifact.evidence_type !== 'signature') continue;
    const subject = byName.get(artifact.subject_artifact_name);
    if (!subject || subject.evidence_type === 'signature' || subject.sha256 !== artifact.subject_sha256) {
      return invalid();
    }
    signedSubjectNames.add(subject.artifact_name);
  }
  for (const artifact of artifacts) {
    if (
      SIGNATURE_REQUIRED_SUBJECT_TYPES.has(artifact.evidence_type) &&
      !signedSubjectNames.has(artifact.artifact_name)
    ) {
      return invalid();
    }
  }
  return Object.freeze(artifacts);
}

async function verifyArtifactBytes(directory, artifact) {
  let handle;
  try {
    handle = await open(
      join(directory, artifact.artifact_name),
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
    );
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== artifact.size_bytes) return invalid();

    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(VERIFY_BUFFER_BYTES);
    let position = 0;
    while (position < metadata.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, metadata.size - position),
        position,
      );
      if (bytesRead <= 0) return invalid();
      digest.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (`sha256:${digest.digest('hex')}` !== artifact.sha256) return invalid();
  } catch (error) {
    if (error instanceof ReleaseEvidenceValidationError) throw error;
    return invalid();
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // The evidence boundary already fails closed if file verification failed.
      }
    }
  }
}

/**
 * Validates one immutable index for release-candidate evidence.
 *
 * The contract binds every retained artifact to one exact source commit, keeps
 * unresolved P0 buyer gaps explicit, and prevents a `stable` channel assertion
 * while any P0 gap remains. SPDX `specVersion` and the SLSA in-toto provenance
 * predicate URI identify the expected evidence formats. Every migration artifact
 * must declare a bounded minimum/maximum source-release compatibility range whose
 * maximum source version is strictly older than the release being produced.
 * Signature evidence must identify an exact retained subject artifact and its
 * SHA-256 digest, and every retained container, checksum manifest, and provenance
 * artifact must have such structural signature coverage. Successful validation
 * does not cryptographically verify the signature or claim certification, SLSA
 * level, accessibility conformance, or release readiness.
 *
 * @param {unknown} value Untrusted machine-readable release evidence.
 * @returns {Readonly<object>} A deeply frozen, bounded release evidence index.
 * @throws {ReleaseEvidenceValidationError} When identity, scope, artifact, or channel evidence is invalid.
 */
function validateReleaseEvidenceIndexUnsafe(value) {
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
  const releaseVersion = parseReleaseVersion(record.version, channel);
  return Object.freeze({
    schema_version: RELEASE_SCHEMA_VERSION,
    channel,
    version: releaseVersion.value,
    source_commit: sourceCommit,
    generated_at: requireGeneratedAt(record.generated_at),
    open_p0_buyer_gaps: requireOpenP0BuyerGaps(record.open_p0_buyer_gaps, channel),
    artifacts: requireArtifacts(record.artifacts, sourceCommit, releaseVersion),
  });
}

export function validateReleaseEvidenceIndex(value) {
  try {
    return validateReleaseEvidenceIndexUnsafe(value);
  } catch {
    return invalid();
  }
}

/**
 * Verifies that every indexed release artifact is the exact regular file claimed.
 *
 * The verifier first applies the structural release contract, rejects a symlinked
 * evidence-directory boundary, then opens each artifact without following a final
 * symlink, streams its bytes through SHA-256, and compares both byte count and
 * digest with the immutable index. It reads only artifact names already accepted
 * by the no-path-separator contract and emits the same payload-free failure for
 * missing, replaced, symlinked, non-regular, short, oversized, or digest-mismatched
 * files. It does not interpret SBOM/provenance content or cryptographically validate
 * detached signatures; those are separate release gates.
 *
 * @param {unknown} value Untrusted release-evidence index.
 * @param {string} artifactDirectory Directory containing the indexed artifact files.
 * @returns {Promise<Readonly<object>>} The validated index after all local bytes match.
 * @throws {ReleaseEvidenceValidationError} When index or file evidence is invalid.
 */
export async function verifyReleaseEvidenceDirectory(value, artifactDirectory) {
  const index = validateReleaseEvidenceIndex(value);
  if (
    typeof artifactDirectory !== 'string' ||
    artifactDirectory.length === 0 ||
    artifactDirectory.includes('\0')
  ) {
    return invalid();
  }
  try {
    const metadata = await lstat(artifactDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) return invalid();
  } catch (error) {
    if (error instanceof ReleaseEvidenceValidationError) throw error;
    return invalid();
  }
  const directory = resolve(artifactDirectory);
  for (const artifact of index.artifacts) {
    await verifyArtifactBytes(directory, artifact);
  }
  return index;
}
