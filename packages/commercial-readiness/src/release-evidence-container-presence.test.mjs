import assert from 'node:assert/strict';
import { it } from 'node:test';

import { validateReleaseEvidenceIndex } from './release-evidence.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function artifact(artifactName, evidenceType, sha256, extra = {}) {
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
  return artifact(artifactName, 'signature', sha256, {
    subject_artifact_name: subjectArtifactName,
    subject_sha256: subjectSha256,
  });
}

function releaseIndex(includeContainer) {
  const provenanceSha = digest('d');
  const checksumSha = digest('e');
  const containerSha = digest('b');
  const artifacts = [
    artifact('life-os-migrations.tar', 'migration', digest('3'), {
      compatibility: {
        minimum_source_version: '0.1.0',
        maximum_source_version: '0.1.0',
      },
    }),
    artifact('life-os.spdx.json', 'sbom', digest('c'), {
      spec_version: '3.0.1',
    }),
    artifact('life-os.intoto.jsonl', 'provenance', provenanceSha, {
      predicate_type: 'https://slsa.dev/provenance/v1',
    }),
    artifact('SHA256SUMS', 'checksum', checksumSha),
    signature('life-os.intoto.jsonl.sig', 'life-os.intoto.jsonl', provenanceSha, digest('f')),
    signature('SHA256SUMS.sig', 'SHA256SUMS', checksumSha, digest('1')),
  ];
  if (includeContainer) {
    artifacts.unshift(artifact('life-os-web.oci.json', 'container', containerSha));
    artifacts.push(
      signature('life-os-web.oci.json.sig', 'life-os-web.oci.json', containerSha, digest('0')),
    );
  }
  return {
    schema_version: 'life-os.release-evidence.v1',
    channel: 'rc',
    version: '0.2.0-rc.1',
    source_commit: SOURCE_COMMIT,
    generated_at: '2026-09-07T11:00:00.000Z',
    open_p0_buyer_gaps: [209, 210],
    artifacts,
  };
}

it('requires container evidence before a release index can satisfy structural admission', () => {
  assert.throws(() => validateReleaseEvidenceIndex(releaseIndex(false)));
  assert.doesNotThrow(() => validateReleaseEvidenceIndex(releaseIndex(true)));
});
