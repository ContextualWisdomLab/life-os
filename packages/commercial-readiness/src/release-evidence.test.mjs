import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateReleaseEvidenceIndex } from './release-evidence.mjs';

const SOURCE_COMMIT = 'f'.repeat(40);
const SHA256 = `sha256:${'a'.repeat(64)}`;
const GENERATED_AT = '2026-09-01T00:00:00.000Z';

function validIndex(overrides = {}) {
  return {
    schema_version: 'life-os.release-evidence.v1',
    release: {
      version: '0.2.0-rc.1',
      channel: 'rc',
      source_commit: SOURCE_COMMIT,
      generated_at: GENERATED_AT,
      ...overrides.release,
    },
    artifacts: [
      {
        artifact_id: 'web-image',
        kind: 'oci-image',
        digest: SHA256,
        source_commit: SOURCE_COMMIT,
      },
    ],
    verifications: [
      {
        verification_id: 'single-host-smoke',
        artifact_ids: ['web-image'],
        profile: 'single-host',
        command: 'life-os verify --profile single-host',
        result: 'passed',
        completed_at: GENERATED_AT,
      },
    ],
    ...overrides,
  };
}

describe('validateReleaseEvidenceIndex', () => {
  it('accepts a bounded RC index whose claims bind to immutable artifacts and one source commit', () => {
    const result = validateReleaseEvidenceIndex(validIndex());

    assert.equal(result.release.channel, 'rc');
    assert.equal(result.release.source_commit, SOURCE_COMMIT);
    assert.deepEqual(result.verifications[0].artifact_ids, ['web-image']);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.release));
    assert.ok(Object.isFrozen(result.artifacts));
  });

  it('rejects stable evidence while canonical P0 buyer gaps remain open', () => {
    assert.throws(
      () =>
        validateReleaseEvidenceIndex(
          validIndex({
            release: {
              version: '1.0.0',
              channel: 'stable',
              source_commit: SOURCE_COMMIT,
              generated_at: GENERATED_AT,
            },
            open_p0_issue_numbers: [209],
          }),
        ),
      /release evidence is invalid/u,
    );
  });

  it('rejects mutable artifact references, source drift, duplicate identities, and unverifiable claims', () => {
    for (const candidate of [
      validIndex({
        artifacts: [
          {
            artifact_id: 'web-image',
            kind: 'oci-image',
            digest: 'ghcr.io/contextualwisdomlab/life-os-web:latest',
            source_commit: SOURCE_COMMIT,
          },
        ],
      }),
      validIndex({
        artifacts: [
          {
            artifact_id: 'web-image',
            kind: 'oci-image',
            digest: SHA256,
            source_commit: 'e'.repeat(40),
          },
        ],
      }),
      validIndex({
        artifacts: [
          {
            artifact_id: 'web-image',
            kind: 'oci-image',
            digest: SHA256,
            source_commit: SOURCE_COMMIT,
          },
          {
            artifact_id: 'web-image',
            kind: 'spdx-sbom',
            digest: `sha256:${'b'.repeat(64)}`,
            source_commit: SOURCE_COMMIT,
          },
        ],
      }),
      validIndex({
        verifications: [
          {
            verification_id: 'single-host-smoke',
            artifact_ids: ['missing-image'],
            profile: 'single-host',
            command: 'life-os verify --profile single-host',
            result: 'passed',
            completed_at: GENERATED_AT,
          },
        ],
      }),
    ]) {
      assert.throws(
        () => validateReleaseEvidenceIndex(candidate),
        /release evidence is invalid/u,
      );
    }
  });

  it('fails closed on malformed timestamps, unbounded commands, unknown fields, and incomplete collections', () => {
    for (const candidate of [
      validIndex({
        release: {
          version: '0.2.0-rc.1',
          channel: 'rc',
          source_commit: SOURCE_COMMIT,
          generated_at: '2026-09-01',
        },
      }),
      validIndex({
        verifications: [
          {
            verification_id: 'single-host-smoke',
            artifact_ids: ['web-image'],
            profile: 'single-host',
            command: 'x'.repeat(2049),
            result: 'passed',
            completed_at: GENERATED_AT,
          },
        ],
      }),
      { ...validIndex(), unexpected: true },
      validIndex({ artifacts: [] }),
      validIndex({ verifications: [] }),
    ]) {
      assert.throws(
        () => validateReleaseEvidenceIndex(candidate),
        /release evidence is invalid/u,
      );
    }
  });
});
