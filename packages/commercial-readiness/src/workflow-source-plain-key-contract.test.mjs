import assert from 'node:assert/strict';
import test from 'node:test';

/** Mirrors the current structural-key recognition used by source verification. */
function assertCurrentStructuralAuthority(stepLines, stepIndent) {
  const directIndent = stepIndent + 2;
  let blockScalarIndent;

  for (let index = 0; index < stepLines.length; index += 1) {
    const line = stepLines[index];
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }

    const indent = /^\s*/u.exec(line)?.[0].length ?? 0;
    if (blockScalarIndent !== undefined) {
      if (indent > blockScalarIndent) {
        continue;
      }
      blockScalarIndent = undefined;
    }

    const structural =
      index === 0
        ? line.slice(stepIndent)
        : indent >= directIndent
          ? line.slice(indent)
          : undefined;
    if (structural === undefined) {
      continue;
    }

    const mappingCandidate = structural.replace(/^-\s+/u, '');
    const mapping = /^[A-Za-z_][A-Za-z0-9_-]*:\s*(.*)$/u.exec(
      mappingCandidate,
    );
    if (!mapping) {
      continue;
    }

    const value = mapping[1].trimStart();
    if (/^[|>](?:[1-9][+-]?|[+-][1-9]?)?(?:\s+#.*)?$/u.test(value)) {
      blockScalarIndent = indent;
    }
  }
}

test('source verification rejects a quoted structural uses key that can hide a second checkout', () => {
  const hostileStep = [
    '      - name: Hidden second checkout',
    '        "uses": actions/checkout@reviewed-sha',
    '        with:',
    '          persist-credentials: false',
    '          ref: refs/heads/main',
  ];

  assert.throws(
    () => assertCurrentStructuralAuthority(hostileStep, 6),
    /canonical plain mapping keys/u,
    'quoted structural keys must not hide executable checkout authority from source verification',
  );
});
