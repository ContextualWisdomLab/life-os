import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertMergeResponseEvidence } from './cli.mjs';

describe('merge response provenance', () => {
  it('accepts only explicit bounded GitHub merge outcome evidence', () => {
    assert.deepEqual(
      assertMergeResponseEvidence({ merged: true, sha: 'a'.repeat(40) }),
      { merged: true, sha: 'a'.repeat(40) },
    );
    assert.deepEqual(assertMergeResponseEvidence({ merged: false }), {
      merged: false,
    });

    for (const malformed of [
      null,
      undefined,
      {},
      { merged: 'true' },
      { merged: 1 },
      { merged: true },
      { merged: true, sha: 'not-a-sha' },
    ]) {
      assert.throws(
        () => assertMergeResponseEvidence(malformed),
        /GitHub merge response was invalid/,
      );
    }
  });
});
