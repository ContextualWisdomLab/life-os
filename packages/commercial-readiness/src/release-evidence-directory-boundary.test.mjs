import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { verifyReleaseEvidenceDirectory } from './release-evidence.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function indexFor(bodies) {
  const artifact = (artifact_name, evidence_type, extra = {}) => {
    const bytes = bodies.get(artifact_name);
    assert.ok(bytes);
    return {
      artifact_name,
      evidence_type,
      ...extra,
      sha256: sha256(bytes),
      size_bytes: bytes.byteLength,
      source_commit: SOURCE_COMMIT,
    };
  };
  return {
    schema_version: 'life-os.release-evidence.v1',
    channel: 'rc',
    version: '0.2.0-rc.1',
    source_commit: SOURCE_COMMIT,
    generated_at: '2026-09-01T14:30:00.000Z',
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
    ],
  };
}

it('refuses a symlinked release-evidence directory even when all target bytes match', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'life-os-release-parent-'));
  const target = await mkdtemp(join(tmpdir(), 'life-os-release-target-'));
  const linked = join(parent, 'evidence');
  const bodies = new Map([
    ['life-os-web.oci.json', Buffer.from('container')],
    ['life-os.spdx.json', Buffer.from('sbom')],
    ['life-os.intoto.jsonl', Buffer.from('provenance')],
    ['SHA256SUMS', Buffer.from('checksums')],
    ['life-os.intoto.jsonl.sig', Buffer.from('signature')],
  ]);
  try {
    for (const [name, bytes] of bodies) {
      await writeFile(join(target, name), bytes, { flag: 'wx' });
    }
    await symlink(target, linked, 'dir');
    await assert.rejects(() => verifyReleaseEvidenceDirectory(indexFor(bodies), linked));
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(target, { recursive: true, force: true });
  }
});
