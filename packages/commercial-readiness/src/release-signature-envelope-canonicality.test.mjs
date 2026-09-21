import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  ReleaseSignatureVerificationError,
  verifyReleaseEvidenceSignatures,
} from './release-signature-verification.mjs';

const RELEASE_SCHEMA_VERSION = 'life-os.release-evidence.v1';
const SIGNATURE_SCHEMA_VERSION = 'life-os.release-signature.v1';
const SOURCE_COMMIT = 'a'.repeat(40);
const CHANNEL = 'rc';
const VERSION = '0.1.0-rc.1';
const GENERATED_AT = '2026-09-01T00:00:00.000Z';
const OPEN_P0_BUYER_GAPS = Object.freeze([209, 210]);
const KEY_ID = 'release-operator-1';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function artifact(artifactName, evidenceType, bytes, extra = {}) {
  return {
    artifact_name: artifactName,
    evidence_type: evidenceType,
    ...extra,
    sha256: sha256(bytes),
    size_bytes: bytes.length,
    source_commit: SOURCE_COMMIT,
  };
}

function compareArtifactNames(left, right) {
  if (left.artifact_name < right.artifact_name) return -1;
  if (left.artifact_name > right.artifact_name) return 1;
  return 0;
}

function signatureMessage(subjectArtifactName, subjectSha256, nonSignatureArtifacts) {
  return Buffer.from(
    [
      SIGNATURE_SCHEMA_VERSION,
      RELEASE_SCHEMA_VERSION,
      SOURCE_COMMIT,
      CHANNEL,
      VERSION,
      GENERATED_AT,
      JSON.stringify(OPEN_P0_BUYER_GAPS),
      JSON.stringify([...nonSignatureArtifacts].sort(compareArtifactNames)),
      subjectArtifactName,
      subjectSha256,
      '',
    ].join('\n'),
    'utf8',
  );
}

function signedEnvelope(privateKey, subjectArtifactName, subjectSha256, nonSignatureArtifacts) {
  return {
    schema_version: SIGNATURE_SCHEMA_VERSION,
    algorithm: 'ed25519',
    key_id: KEY_ID,
    source_commit: SOURCE_COMMIT,
    channel: CHANNEL,
    version: VERSION,
    subject_artifact_name: subjectArtifactName,
    subject_sha256: subjectSha256,
    signature_base64: sign(
      null,
      signatureMessage(subjectArtifactName, subjectSha256, nonSignatureArtifacts),
      privateKey,
    ).toString('base64'),
  };
}

function serializeCanonical(envelope) {
  return Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');
}

function serializeReordered(envelope) {
  return Buffer.from(
    `${JSON.stringify({
      signature_base64: envelope.signature_base64,
      subject_sha256: envelope.subject_sha256,
      subject_artifact_name: envelope.subject_artifact_name,
      version: envelope.version,
      channel: envelope.channel,
      source_commit: envelope.source_commit,
      key_id: envelope.key_id,
      algorithm: envelope.algorithm,
      schema_version: envelope.schema_version,
    })}\n`,
    'utf8',
  );
}

test('rejects a byte-different signature envelope with reordered keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'life-os-release-envelope-order-'));
  try {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const containerName = 'life-os-web.tar';
    const migrationName = 'life-os-migrations.tar';
    const sbomName = 'life-os.spdx.json';
    const provenanceName = 'life-os.provenance.json';
    const checksumName = 'SHA256SUMS';

    const containerBytes = Buffer.from('immutable release payload\n', 'utf8');
    const migrationBytes = Buffer.from('immutable migration payload\n', 'utf8');
    const sbomBytes = Buffer.from('{}\n', 'utf8');
    const provenanceBytes = Buffer.from('{}\n', 'utf8');

    const containerSha = sha256(containerBytes);
    const migrationSha = sha256(migrationBytes);
    const sbomSha = sha256(sbomBytes);
    const provenanceSha = sha256(provenanceBytes);
    const checksumBytes = Buffer.from(
      [
        `${migrationSha.slice('sha256:'.length)}  ${migrationName}\n`,
        `${containerSha.slice('sha256:'.length)}  ${containerName}\n`,
        `${provenanceSha.slice('sha256:'.length)}  ${provenanceName}\n`,
        `${sbomSha.slice('sha256:'.length)}  ${sbomName}\n`,
      ].join(''),
      'utf8',
    );
    const checksumSha = sha256(checksumBytes);

    const nonSignatureArtifacts = [
      artifact(containerName, 'container', containerBytes),
      artifact(migrationName, 'migration', migrationBytes, {
        compatibility: {
          minimum_source_version: '0.0.1',
          maximum_source_version: '0.0.9',
        },
      }),
      artifact(sbomName, 'sbom', sbomBytes, { spec_version: '3.0.1' }),
      artifact(provenanceName, 'provenance', provenanceBytes, {
        predicate_type: 'https://slsa.dev/provenance/v1',
      }),
      artifact(checksumName, 'checksum', checksumBytes),
    ];

    const containerSignatureName = 'life-os-web.tar.sig.json';
    const provenanceSignatureName = 'life-os.provenance.json.sig.json';
    const checksumSignatureName = 'SHA256SUMS.sig.json';
    const containerSignatureBytes = serializeReordered(
      signedEnvelope(privateKey, containerName, containerSha, nonSignatureArtifacts),
    );
    const provenanceSignatureBytes = serializeCanonical(
      signedEnvelope(privateKey, provenanceName, provenanceSha, nonSignatureArtifacts),
    );
    const checksumSignatureBytes = serializeCanonical(
      signedEnvelope(privateKey, checksumName, checksumSha, nonSignatureArtifacts),
    );

    await Promise.all([
      writeFile(join(directory, containerName), containerBytes),
      writeFile(join(directory, migrationName), migrationBytes),
      writeFile(join(directory, sbomName), sbomBytes),
      writeFile(join(directory, provenanceName), provenanceBytes),
      writeFile(join(directory, checksumName), checksumBytes),
      writeFile(join(directory, containerSignatureName), containerSignatureBytes),
      writeFile(join(directory, provenanceSignatureName), provenanceSignatureBytes),
      writeFile(join(directory, checksumSignatureName), checksumSignatureBytes),
    ]);

    const signatureArtifact = (artifactName, bytes, subjectName, subjectDigest) =>
      artifact(artifactName, 'signature', bytes, {
        subject_artifact_name: subjectName,
        subject_sha256: subjectDigest,
      });
    const index = {
      schema_version: RELEASE_SCHEMA_VERSION,
      channel: CHANNEL,
      version: VERSION,
      source_commit: SOURCE_COMMIT,
      generated_at: GENERATED_AT,
      open_p0_buyer_gaps: [...OPEN_P0_BUYER_GAPS],
      artifacts: [
        ...nonSignatureArtifacts,
        signatureArtifact(
          containerSignatureName,
          containerSignatureBytes,
          containerName,
          containerSha,
        ),
        signatureArtifact(
          provenanceSignatureName,
          provenanceSignatureBytes,
          provenanceName,
          provenanceSha,
        ),
        signatureArtifact(
          checksumSignatureName,
          checksumSignatureBytes,
          checksumName,
          checksumSha,
        ),
      ],
    };
    const trustedPublicKeys = {
      [KEY_ID]: publicKey.export({ type: 'spki', format: 'pem' }),
    };

    await assert.rejects(
      verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys),
      ReleaseSignatureVerificationError,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
