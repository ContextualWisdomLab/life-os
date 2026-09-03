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

const SOURCE_COMMIT = 'a'.repeat(40);
const CHANNEL = 'rc';
const VERSION = '0.1.0-rc.1';
const GENERATED_AT = '2026-09-01T00:00:00.000Z';
const KEY_ID = 'release-operator-1';

function sha256(buffer) {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

function signatureMessage(subjectArtifactName, subjectSha256) {
  return Buffer.from(
    [
      'life-os.release-signature.v1',
      SOURCE_COMMIT,
      CHANNEL,
      VERSION,
      subjectArtifactName,
      subjectSha256,
      '',
    ].join('\n'),
    'utf8',
  );
}

async function createFixture({
  mutateEnvelope,
  trustedKeyId = KEY_ID,
  trustedPublicKey,
  sbomBytes: suppliedSbomBytes,
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'life-os-release-signature-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const subjectArtifactName = 'life-os-web.tar';
  const subjectBytes = Buffer.from('immutable release payload\n', 'utf8');
  const subjectSha256 = sha256(subjectBytes);
  const signatureBytes = sign(null, signatureMessage(subjectArtifactName, subjectSha256), privateKey);
  const envelope = {
    schema_version: 'life-os.release-signature.v1',
    algorithm: 'ed25519',
    key_id: KEY_ID,
    source_commit: SOURCE_COMMIT,
    channel: CHANNEL,
    version: VERSION,
    subject_artifact_name: subjectArtifactName,
    subject_sha256: subjectSha256,
    signature_base64: signatureBytes.toString('base64'),
  };
  if (mutateEnvelope) mutateEnvelope(envelope);
  const signatureArtifactName = 'life-os-web.tar.sig.json';
  const signatureArtifactBytes = Buffer.from(`${JSON.stringify(envelope)}\n`, 'utf8');

  const sbomBytes = suppliedSbomBytes ?? Buffer.from('{}\n', 'utf8');
  const provenanceBytes = Buffer.from('{}\n', 'utf8');
  const checksumBytes = Buffer.from(`${subjectSha256}  ${subjectArtifactName}\n`, 'utf8');
  await Promise.all([
    writeFile(join(directory, subjectArtifactName), subjectBytes),
    writeFile(join(directory, signatureArtifactName), signatureArtifactBytes),
    writeFile(join(directory, 'life-os.spdx.json'), sbomBytes),
    writeFile(join(directory, 'life-os.provenance.json'), provenanceBytes),
    writeFile(join(directory, 'SHA256SUMS'), checksumBytes),
  ]);

  const artifact = (artifactName, evidenceType, bytes, extra = {}) => ({
    artifact_name: artifactName,
    evidence_type: evidenceType,
    ...extra,
    sha256: sha256(bytes),
    size_bytes: bytes.length,
    source_commit: SOURCE_COMMIT,
  });
  const index = {
    schema_version: 'life-os.release-evidence.v1',
    channel: CHANNEL,
    version: VERSION,
    source_commit: SOURCE_COMMIT,
    generated_at: GENERATED_AT,
    open_p0_buyer_gaps: [209, 210],
    artifacts: [
      artifact(subjectArtifactName, 'application', subjectBytes),
      artifact('life-os.spdx.json', 'sbom', sbomBytes, { spec_version: '3.0.1' }),
      artifact('life-os.provenance.json', 'provenance', provenanceBytes, {
        predicate_type: 'https://slsa.dev/provenance/v1',
      }),
      artifact('SHA256SUMS', 'checksum', checksumBytes),
      artifact(signatureArtifactName, 'signature', signatureArtifactBytes, {
        subject_artifact_name: subjectArtifactName,
        subject_sha256: subjectSha256,
      }),
    ],
  };

  return {
    directory,
    index,
    subjectArtifactName,
    subjectBytes,
    trustedPublicKeys: {
      [trustedKeyId]: trustedPublicKey ?? publicKey.export({ type: 'spki', format: 'pem' }),
    },
  };
}

async function withFixture(options, callback) {
  const fixture = await createFixture(options);
  try {
    await callback(fixture);
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
}

test('verifies each indexed detached Ed25519 signature against an explicit trusted key', async () => {
  await withFixture({}, async ({ directory, index, trustedPublicKeys }) => {
    const verified = await verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys);
    assert.equal(verified.source_commit, SOURCE_COMMIT);
    assert.equal(verified.channel, CHANNEL);
    assert.equal(verified.version, VERSION);
  });
});

test('fails closed for a forged detached signature without exposing the envelope', async () => {
  await withFixture(
    { mutateEnvelope: (envelope) => (envelope.signature_base64 = Buffer.alloc(64, 7).toString('base64')) },
    async ({ directory, index, trustedPublicKeys }) => {
      await assert.rejects(
        verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys),
        (error) =>
          error instanceof ReleaseSignatureVerificationError &&
          error.message === 'Release signature evidence is invalid',
      );
    },
  );
});

test('rejects unknown key identity and release-identity substitution', async () => {
  await withFixture(
    { mutateEnvelope: (envelope) => (envelope.key_id = 'untrusted-key') },
    async ({ directory, index, trustedPublicKeys }) => {
      await assert.rejects(
        verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys),
        ReleaseSignatureVerificationError,
      );
    },
  );

  await withFixture(
    { mutateEnvelope: (envelope) => (envelope.version = '0.1.0-rc.2') },
    async ({ directory, index, trustedPublicKeys }) => {
      await assert.rejects(
        verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys),
        ReleaseSignatureVerificationError,
      );
    },
  );
});

test('rejects subject substitution and non-Ed25519 trust material', async () => {
  await withFixture(
    { mutateEnvelope: (envelope) => (envelope.subject_sha256 = `sha256:${'0'.repeat(64)}`) },
    async ({ directory, index, trustedPublicKeys }) => {
      await assert.rejects(
        verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys),
        ReleaseSignatureVerificationError,
      );
    },
  );

  const { publicKey: rsaPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  await withFixture(
    { trustedPublicKey: rsaPublicKey.export({ type: 'spki', format: 'pem' }) },
    async ({ directory, index, trustedPublicKeys }) => {
      await assert.rejects(
        verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys),
        ReleaseSignatureVerificationError,
      );
    },
  );
});

test('rejects malformed trusted-key maps and non-canonical signature envelopes', async () => {
  await withFixture({}, async ({ directory, index }) => {
    await assert.rejects(
      verifyReleaseEvidenceSignatures(index, directory, null),
      ReleaseSignatureVerificationError,
    );
  });

  await withFixture(
    { mutateEnvelope: (envelope) => (envelope.unexpected = true) },
    async ({ directory, index, trustedPublicKeys }) => {
      await assert.rejects(
        verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys),
        ReleaseSignatureVerificationError,
      );
    },
  );
});

test('rejects a signed subject that changes after the initial artifact pass', async () => {
  const slowSbomBytes = Buffer.alloc(64 * 1024 * 1024, 0x20);
  await withFixture(
    { sbomBytes: slowSbomBytes },
    async ({ directory, index, subjectArtifactName, subjectBytes, trustedPublicKeys }) => {
      let mutationError;
      const mutation = new Promise((resolve) => {
        setTimeout(async () => {
          try {
            await writeFile(
              join(directory, subjectArtifactName),
              Buffer.alloc(subjectBytes.length, 0x78),
            );
          } catch (error) {
            mutationError = error;
          } finally {
            resolve();
          }
        }, 20);
      });

      let verificationError;
      try {
        await verifyReleaseEvidenceSignatures(index, directory, trustedPublicKeys);
      } catch (error) {
        verificationError = error;
      }
      await mutation;
      if (mutationError) throw mutationError;
      assert.ok(
        verificationError instanceof ReleaseSignatureVerificationError,
        'signature verification must revalidate retained subject bytes after signature checks',
      );
    },
  );
});
