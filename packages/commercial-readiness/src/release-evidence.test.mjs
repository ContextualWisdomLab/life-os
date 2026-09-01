import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  validateReleaseEvidenceIndex,
  verifyReleaseEvidenceDirectory,
} from './release-evidence.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);
const OCI_DIGEST = `sha256:${'b'.repeat(64)}`;
const SBOM_DIGEST = `sha256:${'c'.repeat(64)}`;
const PROVENANCE_DIGEST = `sha256:${'d'.repeat(64)}`;
const CHECKSUM_DIGEST = `sha256:${'e'.repeat(64)}`;
const SIGNATURE_DIGEST = `sha256:${'f'.repeat(64)}`;

function releaseIndex(overrides = {}) {
  return {
    schema_version: 'life-os.release-evidence.v1',
    channel: 'rc',
    version: '0.2.0-rc.1',
    source_commit: SOURCE_COMMIT,
    generated_at: '2026-09-01T14:30:00.000Z',
    open_p0_buyer_gaps: [209, 210],
    artifacts: [
      {
        artifact_name: 'life-os-web.oci.json',
        evidence_type: 'container',
        sha256: OCI_DIGEST,
        size_bytes: 4096,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os.spdx.json',
        evidence_type: 'sbom',
        spec_version: '3.0.1',
        sha256: SBOM_DIGEST,
        size_bytes: 2048,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os.intoto.jsonl',
        evidence_type: 'provenance',
        predicate_type: 'https://slsa.dev/provenance/v1',
        sha256: PROVENANCE_DIGEST,
        size_bytes: 1024,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'SHA256SUMS',
        evidence_type: 'checksum',
        sha256: CHECKSUM_DIGEST,
        size_bytes: 512,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os.intoto.jsonl.sig',
        evidence_type: 'signature',
        subject_artifact_name: 'life-os.intoto.jsonl',
        subject_sha256: PROVENANCE_DIGEST,
        sha256: SIGNATURE_DIGEST,
        size_bytes: 256,
        source_commit: SOURCE_COMMIT,
      },
    ],
    ...overrides,
  };
}

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function releaseIndexForBodies(bodies) {
  const base = releaseIndex();
  return {
    ...base,
    artifacts: base.artifacts.map((artifact) => {
      const bytes = bodies.get(artifact.artifact_name);
      assert.ok(bytes);
      return {
        ...artifact,
        sha256: sha256(bytes),
        size_bytes: bytes.byteLength,
        ...(artifact.evidence_type === 'signature'
          ? {
              subject_sha256: sha256(
                bodies.get(artifact.subject_artifact_name),
              ),
            }
          : {}),
      };
    }),
  };
}

describe('validateReleaseEvidenceIndex', () => {
  it('accepts a bounded RC index while preserving unresolved P0 gaps explicitly', () => {
    const value = validateReleaseEvidenceIndex(releaseIndex());
    assert.equal(value.schema_version, 'life-os.release-evidence.v1');
    assert.equal(value.channel, 'rc');
    assert.deepEqual(value.open_p0_buyer_gaps, [209, 210]);
    assert.equal(value.artifacts.length, 5);
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.artifacts));
    assert.ok(value.artifacts.every(Object.isFrozen));
  });

  it('rejects a stable release while any P0 buyer gap remains open', () => {
    assert.throws(() =>
      validateReleaseEvidenceIndex(
        releaseIndex({ channel: 'stable', version: '1.0.0' }),
      ),
    );
    assert.doesNotThrow(() =>
      validateReleaseEvidenceIndex(
        releaseIndex({
          channel: 'stable',
          version: '1.0.0',
          open_p0_buyer_gaps: [],
        }),
      ),
    );
  });

  it('binds every artifact to the exact source commit and rejects duplicate names', () => {
    const mismatched = releaseIndex();
    mismatched.artifacts[0] = {
      ...mismatched.artifacts[0],
      source_commit: '0'.repeat(40),
    };
    assert.throws(() => validateReleaseEvidenceIndex(mismatched));

    const duplicate = releaseIndex();
    duplicate.artifacts[1] = {
      ...duplicate.artifacts[1],
      artifact_name: duplicate.artifacts[0].artifact_name,
    };
    assert.throws(() => validateReleaseEvidenceIndex(duplicate));
  });

  it('requires explicit SPDX, SLSA provenance, checksum, and bound signature evidence without treating format identity as certification', () => {
    for (const evidenceType of ['sbom', 'provenance', 'checksum', 'signature']) {
      const missing = releaseIndex({
        artifacts: releaseIndex().artifacts.filter(
          (artifact) => artifact.evidence_type !== evidenceType,
        ),
      });
      assert.throws(() => validateReleaseEvidenceIndex(missing));
    }

    const wrongSpdx = releaseIndex();
    wrongSpdx.artifacts[1] = {
      ...wrongSpdx.artifacts[1],
      spec_version: '3.0.0',
    };
    assert.throws(() => validateReleaseEvidenceIndex(wrongSpdx));

    const wrongSlsaPredicate = releaseIndex();
    wrongSlsaPredicate.artifacts[2] = {
      ...wrongSlsaPredicate.artifacts[2],
      predicate_type: 'https://slsa.dev/spec/v1.2/provenance',
    };
    assert.throws(() => validateReleaseEvidenceIndex(wrongSlsaPredicate));

    const missingSubject = releaseIndex();
    missingSubject.artifacts[4] = {
      artifact_name: 'life-os.intoto.jsonl.sig',
      evidence_type: 'signature',
      sha256: SIGNATURE_DIGEST,
      size_bytes: 256,
      source_commit: SOURCE_COMMIT,
    };
    assert.throws(() => validateReleaseEvidenceIndex(missingSubject));

    const wrongSubjectDigest = releaseIndex();
    wrongSubjectDigest.artifacts[4] = {
      ...wrongSubjectDigest.artifacts[4],
      subject_sha256: OCI_DIGEST,
    };
    assert.throws(() => validateReleaseEvidenceIndex(wrongSubjectDigest));

    const missingSubjectArtifact = releaseIndex();
    missingSubjectArtifact.artifacts[4] = {
      ...missingSubjectArtifact.artifacts[4],
      subject_artifact_name: 'missing.intoto.jsonl',
    };
    assert.throws(() => validateReleaseEvidenceIndex(missingSubjectArtifact));
  });

  it('rejects malformed identities, timestamps, semver/channel mismatches, and unbounded collections', () => {
    const invalid = [
      releaseIndex({ schema_version: 'v1' }),
      releaseIndex({ source_commit: 'not-a-commit' }),
      releaseIndex({ generated_at: 'yesterday' }),
      releaseIndex({ version: '0.2.0' }),
      releaseIndex({
        channel: 'stable',
        version: '1.0.0-rc.1',
        open_p0_buyer_gaps: [],
      }),
      releaseIndex({ open_p0_buyer_gaps: [210, 209] }),
      releaseIndex({ open_p0_buyer_gaps: [209, 209] }),
      releaseIndex({
        open_p0_buyer_gaps: Array.from(
          { length: 65 },
          (_, index) => index + 1,
        ),
      }),
      releaseIndex({ artifacts: [] }),
      releaseIndex({
        artifacts: Array.from(
          { length: 129 },
          () => releaseIndex().artifacts[0],
        ),
      }),
    ];
    for (const value of invalid) {
      assert.throws(() => validateReleaseEvidenceIndex(value));
    }
  });

  it('rejects unsafe artifact names, invalid digests, sizes, unknown fields, and misplaced format metadata', () => {
    const mutations = [
      { artifact_name: '../escape' },
      { artifact_name: 'nested/file' },
      { sha256: 'b'.repeat(64) },
      { size_bytes: 0 },
      { size_bytes: Number.MAX_SAFE_INTEGER + 1 },
      { evidence_type: 'container', spec_version: '3.0.1' },
      {
        evidence_type: 'container',
        predicate_type: 'https://slsa.dev/provenance/v1',
      },
      { subject_artifact_name: 'life-os-web.oci.json' },
      { subject_sha256: OCI_DIGEST },
      { unexpected: true },
    ];
    for (const mutation of mutations) {
      const value = releaseIndex();
      value.artifacts[0] = { ...value.artifacts[0], ...mutation };
      assert.throws(() => validateReleaseEvidenceIndex(value));
    }
  });
});

describe('verifyReleaseEvidenceDirectory', () => {
  it('binds every indexed artifact to the exact local bytes and size', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life-os-release-evidence-'));
    const bodies = new Map([
      ['life-os-web.oci.json', Buffer.from('{"image":"digest"}\n')],
      ['life-os.spdx.json', Buffer.from('{"spdxVersion":"3.0.1"}\n')],
      ['life-os.intoto.jsonl', Buffer.from('{"predicateType":"slsa"}\n')],
      ['SHA256SUMS', Buffer.from('checksum manifest\n')],
      ['life-os.intoto.jsonl.sig', Buffer.from('detached signature bytes\n')],
    ]);
    try {
      for (const [name, bytes] of bodies) {
        await writeFile(join(directory, name), bytes, { flag: 'wx' });
      }
      const index = releaseIndexForBodies(bodies);
      const verified = await verifyReleaseEvidenceDirectory(index, directory);
      assert.equal(verified.source_commit, SOURCE_COMMIT);
      assert.equal(verified.artifacts.length, bodies.size);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when indexed bytes or sizes do not match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life-os-release-evidence-'));
    const bodies = new Map([
      ['life-os-web.oci.json', Buffer.from('container')],
      ['life-os.spdx.json', Buffer.from('sbom')],
      ['life-os.intoto.jsonl', Buffer.from('provenance')],
      ['SHA256SUMS', Buffer.from('checksums')],
      ['life-os.intoto.jsonl.sig', Buffer.from('signature')],
    ]);
    try {
      for (const [name, bytes] of bodies) {
        await writeFile(join(directory, name), bytes, { flag: 'wx' });
      }
      const index = releaseIndexForBodies(bodies);
      await writeFile(join(directory, 'life-os.spdx.json'), 'tampered', {
        flag: 'w',
      });
      await assert.rejects(() => verifyReleaseEvidenceDirectory(index, directory));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('refuses symlinked artifact paths even when the target bytes match', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life-os-release-evidence-'));
    const targetDirectory = await mkdtemp(
      join(tmpdir(), 'life-os-release-evidence-target-'),
    );
    const bodies = new Map([
      ['life-os-web.oci.json', Buffer.from('container')],
      ['life-os.spdx.json', Buffer.from('sbom')],
      ['life-os.intoto.jsonl', Buffer.from('provenance')],
      ['SHA256SUMS', Buffer.from('checksums')],
      ['life-os.intoto.jsonl.sig', Buffer.from('signature')],
    ]);
    try {
      for (const [name, bytes] of bodies) {
        if (name === 'SHA256SUMS') continue;
        await writeFile(join(directory, name), bytes, { flag: 'wx' });
      }
      const target = join(targetDirectory, 'SHA256SUMS');
      await writeFile(target, bodies.get('SHA256SUMS'), { flag: 'wx' });
      await symlink(target, join(directory, 'SHA256SUMS'));
      await assert.rejects(() =>
        verifyReleaseEvidenceDirectory(releaseIndexForBodies(bodies), directory),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(targetDirectory, { recursive: true, force: true });
    }
  });
});
