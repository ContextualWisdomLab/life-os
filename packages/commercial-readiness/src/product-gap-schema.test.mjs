import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateProductGapRegistry } from './product-gap-schema.mjs';

const valid = {
  schema: 'life-os.product-gap-registry.v1',
  gaps: [
    { capability_id: 'today.action-loop', tracking_issue: 121 },
    { capability_id: 'data.portability-rights', tracking_issue: 55 },
  ],
};

describe('product gap registry schema', () => {
  it('normalizes one explicit canonical issue per registered buyer outcome', () => {
    assert.deepEqual(validateProductGapRegistry(valid), valid);
  });

  it('rejects unknown keys, malformed identities, and duplicate mappings', () => {
    for (const value of [
      { ...valid, extra: true },
      { schema: valid.schema, gaps: [{ capability_id: 'today', tracking_issue: 121 }] },
      { schema: valid.schema, gaps: [{ capability_id: 'today.action-loop', tracking_issue: 0 }] },
      {
        schema: valid.schema,
        gaps: [
          { capability_id: 'today.action-loop', tracking_issue: 121 },
          { capability_id: 'today.action-loop', tracking_issue: 122 },
        ],
      },
      {
        schema: valid.schema,
        gaps: [
          { capability_id: 'today.action-loop', tracking_issue: 121 },
          { capability_id: 'calendar.time-blocking', tracking_issue: 121 },
        ],
      },
    ]) {
      assert.throws(() => validateProductGapRegistry(value), /Invalid product gap registry/);
    }
  });
});
