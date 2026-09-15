import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');
const workflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/commercial-readiness.yml',
  '.github/workflows/ai-proposal-live-conformance.yml',
  '.github/workflows/opencode-commercial-development.yml',
  '.github/workflows/appguardrail.yml',
];

/** Return leading indentation so scalar ownership can be bounded without parsing payload text. */
function lineIndent(line) {
  return line.length - line.trimStart().length;
}

/** Identify YAML literal/folded scalar headers whose body must not create executable authority. */
function isBlockScalarHeader(line) {
  return /(?:^|:\s+|-\s+)[|>](?:[1-9][+-]?|[+-][1-9]?)?\s*(?:#.*)?$/.test(
    line.trimStart(),
  );
}

/**
 * Determine whether a candidate line is owned by an enclosing block scalar.
 * Security contracts must ignore scalar text even when it resembles a workflow mapping key.
 */
function isInsideBlockScalar(lines, lineIndex) {
  const targetIndent = lineIndent(lines[lineIndex]);

  for (let headerIndex = lineIndex - 1; headerIndex >= 0; headerIndex -= 1) {
    const header = lines[headerIndex];
    if (header.trim() === '') continue;
    const headerIndent = lineIndent(header);
    if (headerIndent >= targetIndent || !isBlockScalarHeader(header)) continue;

    let boundedByHeader = true;
    for (let index = headerIndex + 1; index <= lineIndex; index += 1) {
      const candidate = lines[index];
      if (candidate.trim() === '') continue;
      if (lineIndent(candidate) <= headerIndent) {
        boundedByHeader = false;
        break;
      }
    }
    if (boundedByHeader) return true;
  }

  return false;
}

/**
 * Reject quoted `uses` mapping keys outside scalar payloads.
 * YAML normalizes quoted and unquoted mapping keys to the same semantic key, while the
 * existing checkout-authority contract intentionally recognizes the canonical unquoted form.
 */
function expectCanonicalUsesKeys(path, workflow) {
  const lines = workflow.split(String.fromCharCode(10));
  const quotedUsesKeyIndexes = lines.flatMap((line, index) => {
    if (isInsideBlockScalar(lines, index)) return [];
    return /^\s*(?:-\s+)?["']uses["']\s*:/.test(line) ? [index] : [];
  });

  expect(quotedUsesKeyIndexes, `${path} quoted uses keys`).toHaveLength(0);
}

describe('persistent GitHub Action uses-key authority', () => {
  it('keeps executable uses mapping keys in the canonical unquoted form', () => {
    for (const path of workflowPaths) {
      expectCanonicalUsesKeys(
        path,
        readFileSync(resolve(repositoryRoot, path), 'utf8'),
      );
    }
  });

  it('rejects a quoted uses key that YAML treats as executable authority', () => {
    const hostileWorkflow = [
      'steps:',
      '  - name: Reviewed checkout',
      '    uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      '    env:',
      "      GIT_CONFIG_COUNT: '1'",
      '      GIT_CONFIG_KEY_0: init.defaultBranch',
      '      GIT_CONFIG_VALUE_0: main',
      '  - name: Hostile quoted-key checkout',
      '    "uses": actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectCanonicalUsesKeys('hostile-quoted-uses-key.yml', hostileWorkflow),
    ).toThrow();
  });

  it('does not treat quoted uses text inside a block scalar as YAML authority', () => {
    const controlWorkflow = [
      'steps:',
      '  - name: Explain a rejected shape',
      '    run: |',
      '      echo \"\\\"uses\\\": actions/checkout@example\"',
    ].join(String.fromCharCode(10));

    expectCanonicalUsesKeys('block-scalar-control.yml', controlWorkflow);
  });
});
