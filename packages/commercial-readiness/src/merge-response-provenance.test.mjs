import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertMergeResponseEvidence } from './cli.mjs';

describe('merge response provenance', () => {
  it('accepts only an explicit GitHub merged=true response as success evidence', () => {
    assert.deepEqual(assertMergeResponseEvidence({ merged: true, sha: 'a'.repeat(40) }), {
      merged: true,
      sha: 'a'.repeat(40),
    });

    for (const malformed of [null, undefined, {}, { merged: 'true' }, { merged: 1 }]) {
      assert.throws(
        () => assertMergeResponseEvidence(malformed),
        /GitHub merge response was invalid/,
      );
    }
  });
});
