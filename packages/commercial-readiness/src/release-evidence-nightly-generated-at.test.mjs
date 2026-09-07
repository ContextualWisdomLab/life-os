import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateReleaseEvidenceIndex } from './release-evidence.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);

function nightlyReleaseIndex({
  version = '0.2.0-nightly.20260228.1',
  generatedAt = '2026-02-28T14:30:00.000Z',
} = {}) {
  return {
    schema_version: 'life-os.release-evidence.v1',
    channel: 'nightly',
    version,
    source_commit: SOURCE_COMMIT,
    generated_at: generatedAt,
    open_p0_buyer_gaps: [209, 210],
    artifacts: [
      {
        artifact_name: 'life-os-web.oci.json',
        evidence_type: 'container',
        sha256: `sha256:${'b'.repeat(64)}`,
        size_bytes: 4096,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os-migrations.tar',
        evidence_type: 'migration',
        compatibility: {
          minimum_source_version: '0.1.0',
          maximum_source_version: '0.1.0',
        },
        sha256: `sha256:${'2'.repeat(64)}`,
        size_bytes: 3072,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os.spdx.json',
        evidence_type: 'sbom',
        spec_version: '3.0.1',
        sha256: `sha256:${'c'.repeat(64)}`,
        size_bytes: 2048,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os.intoto.jsonl',
        evidence_type: 'provenance',
        predicate_type: 'https://slsa.dev/provenance/v1',
        sha256: `sha256:${'d'.repeat(64)}`,
        size_bytes: 1024,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'SHA256SUMS',
        evidence_type: 'checksum',
        sha256: `sha256:${'e'.repeat(64)}`,
        size_bytes: 512,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os.intoto.jsonl.sig',
        evidence_type: 'signature',
        subject_artifact_name: 'life-os.intoto.jsonl',
        subject_sha256: `sha256:${'d'.repeat(64)}`,
        sha256: `sha256:${'f'.repeat(64)}`,
        size_bytes: 256,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'life-os-web.oci.json.sig',
        evidence_type: 'signature',
        subject_artifact_name: 'life-os-web.oci.json',
        subject_sha256: `sha256:${'b'.repeat(64)}`,
        sha256: `sha256:${'0'.repeat(64)}`,
        size_bytes: 256,
        source_commit: SOURCE_COMMIT,
      },
      {
        artifact_name: 'SHA256SUMS.sig',
        evidence_type: 'signature',
        subject_artifact_name: 'SHA256SUMS',
        subject_sha256: `sha256:${'e'.repeat(64)}`,
        sha256: `sha256:${'1'.repeat(64)}`,
        size_bytes: 256,
        source_commit: SOURCE_COMMIT,
      },
    ],
  };
}

describe('nightly release generated-at identity', () => {
  it('requires the nightly YYYYMMDD identity to match the canonical UTC generated_at date', () => {
    assert.doesNotThrow(() => validateReleaseEvidenceIndex(nightlyReleaseIndex()));

    assert.throws(() =>
      validateReleaseEvidenceIndex(
        nightlyReleaseIndex({ version: '0.2.0-nightly.20260227.1' }),
      ),
    );

    assert.throws(() =>
      validateReleaseEvidenceIndex(
        nightlyReleaseIndex({ generatedAt: '2026-03-01T00:00:00.000Z' }),
      ),
    );
  });
});
