import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ReleaseEvidenceValidationError,
  validateReleaseEvidenceIndex,
} from './release-evidence.mjs';

const SECRET_NATIVE_DETAIL = 'postgresql://release-admin:must-not-escape@runtime.invalid/lifeos';

function assertBoundedValidationFailure(run) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof ReleaseEvidenceValidationError);
    assert.equal(error.message, 'Release evidence index is invalid');
    assert.equal(String(error).includes(SECRET_NATIVE_DETAIL), false);
    return true;
  });
}

describe('release evidence hostile object boundary', () => {
  it('collapses a throwing top-level field accessor into the fixed validation failure', () => {
    const hostile = {
      get schema_version() {
        throw new Error(SECRET_NATIVE_DETAIL);
      },
      channel: 'rc',
      version: '0.2.0-rc.1',
      source_commit: 'a'.repeat(40),
      generated_at: '2026-09-07T09:00:00.000Z',
      open_p0_buyer_gaps: [210],
      artifacts: [],
    };

    assertBoundedValidationFailure(() => validateReleaseEvidenceIndex(hostile));
  });

  it('collapses hostile own-key enumeration into the fixed validation failure', () => {
    const hostile = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error(SECRET_NATIVE_DETAIL);
        },
      },
    );

    assertBoundedValidationFailure(() => validateReleaseEvidenceIndex(hostile));
  });
});
