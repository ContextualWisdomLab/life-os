import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateReleaseEvidenceIndex } from './schema.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);
const OCI_DIGEST = `sha256:${'b'.repeat(64)}`;
const SBOM_DIGEST = `sha256:${'c'.repeat(64)}`;
const PROVENANCE_DIGEST = `sha256:${'d'.repeat(64)}`;
const CHECKSUM_DIGEST = `sha256:${'e'.repeat(64)}`;

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
        standard: 'SPDX-3.0.1',
        sha256: SBOM_DIGEST,
        size_bytes: 2048,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os.intoto.jsonl',
        evidence_type: 'provenance',
        standard: 'SLSA-v1.2-provenance',
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
    ],
    ...overrides,
  };
}

describe('validateReleaseEvidenceIndex', () => {
  it('accepts a bounded RC index while preserving unresolved P0 gaps explicitly', () => {
    const value = validateReleaseEvidenceIndex(releaseIndex());
    assert.equal(value.schema_version, 'life-os.release-evidence.v1');
    assert.equal(value.channel, 'rc');
    assert.deepEqual(value.open_p0_buyer_gaps, [209, 210]);
    assert.equal(value.artifacts.length, 4);
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
      source_commit: 'f'.repeat(40),
    };
    assert.throws(() => validateReleaseEvidenceIndex(mismatched));

    const duplicate = releaseIndex();
    duplicate.artifacts[1] = {
      ...duplicate.artifacts[1],
      artifact_name: duplicate.artifacts[0].artifact_name,
    };
    assert.throws(() => validateReleaseEvidenceIndex(duplicate));
  });

  it('requires explicit SPDX, SLSA provenance, and checksum evidence without treating labels as certification', () => {
    for (const evidenceType of ['sbom', 'provenance', 'checksum']) {
      const missing = releaseIndex({
        artifacts: releaseIndex().artifacts.filter(
          (artifact) => artifact.evidence_type !== evidenceType,
        ),
      });
      assert.throws(() => validateReleaseEvidenceIndex(missing));
    }

    const wrongStandard = releaseIndex();
    wrongStandard.artifacts[1] = {
      ...wrongStandard.artifacts[1],
      standard: 'SPDX-3.0',
    };
    assert.throws(() => validateReleaseEvidenceIndex(wrongStandard));
  });

  it('rejects malformed identities, timestamps, semver/channel mismatches, and unbounded collections', () => {
    const invalid = [
      releaseIndex({ schema_version: 'v1' }),
      releaseIndex({ source_commit: 'not-a-commit' }),
      releaseIndex({ generated_at: 'yesterday' }),
      releaseIndex({ version: '0.2.0' }),
      releaseIndex({ channel: 'stable', version: '1.0.0-rc.1', open_p0_buyer_gaps: [] }),
      releaseIndex({ open_p0_buyer_gaps: [210, 209] }),
      releaseIndex({ open_p0_buyer_gaps: [209, 209] }),
      releaseIndex({ open_p0_buyer_gaps: Array.from({ length: 65 }, (_, index) => index + 1) }),
      releaseIndex({ artifacts: [] }),
      releaseIndex({ artifacts: Array.from({ length: 129 }, () => releaseIndex().artifacts[0]) }),
    ];
    for (const value of invalid) {
      assert.throws(() => validateReleaseEvidenceIndex(value));
    }
  });

  it('rejects unsafe artifact names, invalid digests, sizes, unknown fields, and misplaced standards', () => {
    const mutations = [
      { artifact_name: '../escape' },
      { artifact_name: 'nested/file' },
      { sha256: 'b'.repeat(64) },
      { size_bytes: 0 },
      { size_bytes: Number.MAX_SAFE_INTEGER + 1 },
      { evidence_type: 'container', standard: 'SPDX-3.0.1' },
      { unexpected: true },
    ];
    for (const mutation of mutations) {
      const value = releaseIndex();
      value.artifacts[0] = { ...value.artifacts[0], ...mutation };
      assert.throws(() => validateReleaseEvidenceIndex(value));
    }
  });
});
