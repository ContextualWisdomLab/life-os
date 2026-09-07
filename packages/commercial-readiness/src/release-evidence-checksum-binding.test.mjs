import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { verifyReleaseEvidenceDirectory } from './release-evidence.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function canonicalChecksumBody(bodies) {
  return Buffer.from(
    [
      'life-os-migrations.tar',
      'life-os-web.oci.json',
      'life-os.intoto.jsonl',
      'life-os.spdx.json',
    ]
      .sort()
      .map((name) => `${sha256(bodies.get(name)).slice('sha256:'.length)}  ${name}\n`)
      .join(''),
  );
}

function releaseIndexForBodies(bodies) {
  const artifact = (artifactName, evidenceType, extra = {}) => ({
    artifact_name: artifactName,
    evidence_type: evidenceType,
    ...extra,
    sha256: sha256(bodies.get(artifactName)),
    size_bytes: bodies.get(artifactName).byteLength,
    source_commit: SOURCE_COMMIT,
  });

  return {
    schema_version: 'life-os.release-evidence.v1',
    channel: 'rc',
    version: '0.2.0-rc.1',
    source_commit: SOURCE_COMMIT,
    generated_at: '2026-09-08T00:00:00.000Z',
    open_p0_buyer_gaps: [209, 210],
    artifacts: [
      artifact('life-os-web.oci.json', 'container'),
      artifact('life-os.spdx.json', 'sbom', { spec_version: '3.0.1' }),
      artifact('life-os.intoto.jsonl', 'provenance', {
        predicate_type: 'https://slsa.dev/provenance/v1',
      }),
      artifact('SHA256SUMS', 'checksum'),
      artifact('life-os.intoto.jsonl.sig', 'signature', {
        subject_artifact_name: 'life-os.intoto.jsonl',
        subject_sha256: sha256(bodies.get('life-os.intoto.jsonl')),
      }),
      artifact('life-os-web.oci.json.sig', 'signature', {
        subject_artifact_name: 'life-os-web.oci.json',
        subject_sha256: sha256(bodies.get('life-os-web.oci.json')),
      }),
      artifact('SHA256SUMS.sig', 'signature', {
        subject_artifact_name: 'SHA256SUMS',
        subject_sha256: sha256(bodies.get('SHA256SUMS')),
      }),
      artifact('life-os-migrations.tar', 'migration', {
        compatibility: {
          minimum_source_version: '0.1.0',
          maximum_source_version: '0.1.0',
        },
      }),
    ],
  };
}

async function writeBodies(directory, bodies) {
  for (const [name, bytes] of bodies) {
    await writeFile(join(directory, name), bytes, { flag: 'wx' });
  }
}

function baseBodies() {
  return new Map([
    ['life-os-web.oci.json', Buffer.from('{"image":"sha256:buyer-verifiable"}\n')],
    ['life-os.spdx.json', Buffer.from('{"spdxVersion":"3.0.1"}\n')],
    ['life-os.intoto.jsonl', Buffer.from('{"predicateType":"https://slsa.dev/provenance/v1"}\n')],
    ['life-os-migrations.tar', Buffer.from('migration bundle\n')],
    ['life-os.intoto.jsonl.sig', Buffer.from('provenance detached signature\n')],
    ['life-os-web.oci.json.sig', Buffer.from('container detached signature\n')],
    ['SHA256SUMS.sig', Buffer.from('checksum detached signature\n')],
  ]);
}

describe('verifyReleaseEvidenceDirectory checksum binding', () => {
  it('rejects a digest-valid checksum artifact that does not bind retained release subjects', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life-os-release-checksum-red-'));
    const bodies = baseBodies();
    bodies.set('SHA256SUMS', Buffer.from(`${'0'.repeat(64)}  unrelated.bin\n`));
    try {
      await writeBodies(directory, bodies);
      await assert.rejects(() =>
        verifyReleaseEvidenceDirectory(releaseIndexForBodies(bodies), directory),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('accepts one canonical checksum manifest that exactly binds every retained non-signature subject', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'life-os-release-checksum-green-'));
    const bodies = baseBodies();
    bodies.set('SHA256SUMS', canonicalChecksumBody(bodies));
    try {
      await writeBodies(directory, bodies);
      const verified = await verifyReleaseEvidenceDirectory(
        releaseIndexForBodies(bodies),
        directory,
      );
      assert.equal(verified.source_commit, SOURCE_COMMIT);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
