import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyWorkflowRegistry } from './workflow-registry.mjs';

test('rejects noncanonical uppercase commit evidence instead of recanonicalizing it', () => {
  assert.throws(
    () =>
      classifyWorkflowRegistry({
        commitSha: 'A'.repeat(40),
        treePaths: [],
        workflows: [],
      }),
    /commit SHA.*invalid/i,
  );
});
