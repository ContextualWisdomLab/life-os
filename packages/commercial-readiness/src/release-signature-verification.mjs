import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto';
import { constants as fileConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { verifyReleaseEvidenceDirectory } from './release-evidence.mjs';

const SIGNATURE_SCHEMA_VERSION = 'life-os.release-signature.v1';
const SIGNATURE_ALGORITHM = 'ed25519';
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAXIMUM_TRUSTED_KEYS = 64;
const MAXIMUM_SIGNATURE_ENVELOPE_BYTES = 16 * 1024;
const ED25519_SIGNATURE_BYTES = 64;

/**
 * Stable failure for detached-signature evidence that cannot establish release authority.
 *
 * The error deliberately carries no key identifier, signature bytes, artifact name, or
 * parser/crypto exception. Release verification can therefore fail closed without
 * reflecting untrusted evidence into logs or public responses.
 */
export class ReleaseSignatureVerificationError extends Error {
  /** Creates the payload-free signature-verification failure. */
  constructor() {
    super('Release signature evidence is invalid');
    this.name = 'ReleaseSignatureVerificationError';
  }
}

/** Fails the signature gate without retaining untrusted evidence. */
function invalidSignature() {
  throw new ReleaseSignatureVerificationError();
}

/** Requires an ordinary or null-prototype record so inherited properties never become trust data. */
function requirePlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalidSignature();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalidSignature();
  return value;
}

/** Requires one exact object shape; additional envelope fields are not forward-authorized implicitly. */
function requireExactKeys(record, expected) {
  const actual = Object.keys(record).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    return invalidSignature();
  }
}

/** Validates and materializes the explicit Ed25519 trust set supplied by the release operator. */
function requireTrustedPublicKeys(value) {
  const record = requirePlainObject(value);
  const entries = Object.entries(record);
  if (entries.length === 0 || entries.length > MAXIMUM_TRUSTED_KEYS) return invalidSignature();

  const trustedKeys = new Map();
  for (const [keyId, encodedKey] of entries) {
    if (!KEY_ID_PATTERN.test(keyId) || typeof encodedKey !== 'string' || encodedKey.length === 0) {
      return invalidSignature();
    }
    let publicKey;
    try {
      publicKey = createPublicKey(encodedKey);
    } catch {
      return invalidSignature();
    }
    if (publicKey.asymmetricKeyType !== 'ed25519') return invalidSignature();
    trustedKeys.set(keyId, publicKey);
  }
  return trustedKeys;
}

/** Reopens one indexed signature artifact without following a final symlink and rechecks its bytes. */
async function readVerifiedSignatureEnvelope(directory, artifact) {
  let handle;
  try {
    handle = await open(
      join(directory, artifact.artifact_name),
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
    );
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.size !== artifact.size_bytes ||
      metadata.size <= 0 ||
      metadata.size > MAXIMUM_SIGNATURE_ENVELOPE_BYTES
    ) {
      return invalidSignature();
    }

    const bytes = Buffer.allocUnsafe(metadata.size);
    let position = 0;
    while (position < bytes.length) {
      const { bytesRead } = await handle.read(bytes, position, bytes.length - position, position);
      if (bytesRead <= 0) return invalidSignature();
      position += bytesRead;
    }
    const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    if (digest !== artifact.sha256) return invalidSignature();
    return bytes;
  } catch (error) {
    if (error instanceof ReleaseSignatureVerificationError) throw error;
    return invalidSignature();
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {
        // Verification has already failed closed if closing the evidence handle is unreliable.
      }
    }
  }
}

/** Parses one canonical, bounded signature envelope and rejects parser-dependent representations. */
function parseCanonicalSignatureEnvelope(bytes) {
  let record;
  try {
    record = requirePlainObject(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    if (error instanceof ReleaseSignatureVerificationError) throw error;
    return invalidSignature();
  }
  requireExactKeys(record, [
    'schema_version',
    'algorithm',
    'key_id',
    'source_commit',
    'channel',
    'version',
    'subject_artifact_name',
    'subject_sha256',
    'signature_base64',
  ]);

  const canonical = Buffer.from(`${JSON.stringify(record)}\n`, 'utf8');
  if (!canonical.equals(bytes)) return invalidSignature();
  return record;
}

/** Decodes a canonical Ed25519 signature and rejects permissive Base64 parser variants. */
function requireSignatureBytes(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
    return invalidSignature();
  }
  const bytes = Buffer.from(value, 'base64');
  if (
    bytes.length !== ED25519_SIGNATURE_BYTES ||
    bytes.toString('base64') !== value
  ) {
    return invalidSignature();
  }
  return bytes;
}

/** Builds the versioned signed statement that binds release, subject identity, and exact digest. */
function signatureMessage(index, artifact) {
  return Buffer.from(
    [
      SIGNATURE_SCHEMA_VERSION,
      index.source_commit,
      index.channel,
      index.version,
      artifact.subject_artifact_name,
      artifact.subject_sha256,
      '',
    ].join('\n'),
    'utf8',
  );
}

/** Verifies envelope identity and the Ed25519 signature for one indexed signature artifact. */
async function verifyIndexedSignature(index, directory, artifact, trustedKeys) {
  const envelopeBytes = await readVerifiedSignatureEnvelope(directory, artifact);
  const envelope = parseCanonicalSignatureEnvelope(envelopeBytes);
  if (
    envelope.schema_version !== SIGNATURE_SCHEMA_VERSION ||
    envelope.algorithm !== SIGNATURE_ALGORITHM ||
    typeof envelope.key_id !== 'string' ||
    !KEY_ID_PATTERN.test(envelope.key_id) ||
    envelope.source_commit !== index.source_commit ||
    envelope.channel !== index.channel ||
    envelope.version !== index.version ||
    envelope.subject_artifact_name !== artifact.subject_artifact_name ||
    envelope.subject_sha256 !== artifact.subject_sha256
  ) {
    return invalidSignature();
  }

  const publicKey = trustedKeys.get(envelope.key_id);
  if (!publicKey) return invalidSignature();
  const signatureBytes = requireSignatureBytes(envelope.signature_base64);
  if (!verifySignature(null, signatureMessage(index, artifact), publicKey, signatureBytes)) {
    return invalidSignature();
  }
}

/**
 * Cryptographically verifies every detached signature referenced by one release-evidence index.
 *
 * Structural validation and byte/digest verification run first through the release-evidence
 * contract. Each detached signature envelope is then reopened without following a final symlink,
 * rebound to the exact source commit, release channel/version, subject artifact name and digest,
 * and verified with Ed25519 against an operator-supplied explicit trust map. Trust is never
 * inferred from a key embedded in the artifact, a GitHub actor, or model output. The function
 * establishes signature validity only; it does not distribute/rotate trust roots, claim release
 * readiness, or substitute for SBOM, provenance, install, recovery, accessibility, or buyer-
 * journey acceptance gates.
 *
 * @param {unknown} value Untrusted `life-os.release-evidence.v1` index.
 * @param {string} artifactDirectory Directory containing the exact indexed artifacts.
 * @param {unknown} trustedPublicKeys Explicit key-id to PEM-encoded Ed25519 public-key mapping.
 * @returns {Promise<Readonly<object>>} The validated release index after every signature verifies.
 * @throws {ReleaseSignatureVerificationError} When structural, byte, trust, envelope, or signature evidence is invalid.
 */
export async function verifyReleaseEvidenceSignatures(
  value,
  artifactDirectory,
  trustedPublicKeys,
) {
  try {
    const trustedKeys = requireTrustedPublicKeys(trustedPublicKeys);
    const index = await verifyReleaseEvidenceDirectory(value, artifactDirectory);
    const directory = resolve(artifactDirectory);
    for (const artifact of index.artifacts) {
      if (artifact.evidence_type !== 'signature') continue;
      await verifyIndexedSignature(index, directory, artifact, trustedKeys);
    }
    return index;
  } catch (error) {
    if (error instanceof ReleaseSignatureVerificationError) throw error;
    throw new ReleaseSignatureVerificationError();
  }
}
