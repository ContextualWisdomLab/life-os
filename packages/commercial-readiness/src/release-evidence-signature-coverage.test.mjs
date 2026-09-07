import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateReleaseEvidenceIndex } from './release-evidence.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);

function digest(hex) {
  return `sha256:${hex.repeat(64)}`;
}

function retainedArtifact(artifactName, evidenceType, sha256, extra = {}) {
  return {
    artifact_name: artifactName,
    evidence_type: evidenceType,
    sha256,
    size_bytes: 1,
    source_commit: SOURCE_COMMIT,
    ...extra,
  };
}

function signature(artifactName, subjectArtifactName, subjectSha256, sha256) {
  return retainedArtifact(artifactName, 'signature', sha256, {
    subject_artifact_name: subjectArtifactName,
    subject_sha256: subjectSha256,
  });
}

function releaseIndex(signatures) {
  const containerSha = digest('b');
  const provenanceSha = digest('d');
  const checksumSha = digest('e');
  return {
    schema_version: 'life-os.release-evidence.v1',
    channel: 'rc',
    version: '0.2.0-rc.1',
    source_commit: SOURCE_COMMIT,
    generated_at: '2026-09-07T10:00:00.000Z',
    open_p0_buyer_gaps: [209, 210],
    artifacts: [
      retainedArtifact('life-os-web.oci.json', 'container', containerSha),
      retainedArtifact('life-os-migrations.tar', 'migration', digest('2')),
      retainedArtifact('life-os.spdx.json', 'sbom', digest('c'), {
        spec_version: '3.0.1',
      }),
      retainedArtifact('life-os.intoto.jsonl', 'provenance', provenanceSha, {
        predicate_type: 'https://slsa.dev/provenance/v1',
      }),
      retainedArtifact('SHA256SUMS', 'checksum', checksumSha),
      ...signatures({ containerSha, provenanceSha, checksumSha }),
    ],
  };
}

describe('release evidence signature coverage', () => {
  it('rejects an index when required release subjects are not each covered by detached signature evidence', () => {
    const incomplete = releaseIndex(({ provenanceSha }) => [
      signature(
        'life-os.intoto.jsonl.sig',
        'life-os.intoto.jsonl',
        provenanceSha,
        digest('f'),
      ),
    ]);

    assert.throws(() => validateReleaseEvidenceIndex(incomplete), {
      name: 'ReleaseEvidenceValidationError',
    });
  });

  it('accepts structural signature coverage for every retained container, checksum manifest, and provenance artifact', () => {
    const complete = releaseIndex(({ containerSha, provenanceSha, checksumSha }) => [
      signature(
        'life-os-web.oci.json.sig',
        'life-os-web.oci.json',
        containerSha,
        digest('f'),
      ),
      signature(
        'SHA256SUMS.sig',
        'SHA256SUMS',
        checksumSha,
        digest('0'),
      ),
      signature(
        'life-os.intoto.jsonl.sig',
        'life-os.intoto.jsonl',
        provenanceSha,
        digest('1'),
      ),
    ]);

    assert.doesNotThrow(() => validateReleaseEvidenceIndex(complete));
  });
});
