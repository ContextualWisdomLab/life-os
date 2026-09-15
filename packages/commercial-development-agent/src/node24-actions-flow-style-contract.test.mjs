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

function lineIndent(line) {
  return line.length - line.trimStart().length;
}

function isBlockScalarHeader(line) {
  return /(?:^|:\s+|-\s+)[|>](?:[1-9][+-]?|[+-][1-9]?)?\s*(?:#.*)?$/.test(
    line.trimStart(),
  );
}

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

function flowBraceDelta(line) {
  let depth = 0;
  let quote = null;
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (quote === '"') {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        quote = null;
      }
      continue;
    }

    if (quote === "'") {
      if (character === "'" && line[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = null;
      }
      continue;
    }

    if (character === '#') break;
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
    }
  }

  return depth;
}

function expectNoFlowStyleReviewedActionSteps(path, workflow) {
  const lines = workflow.split(String.fromCharCode(10));

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (isInsideBlockScalar(lines, lineIndex)) continue;

    const line = lines[lineIndex];
    const trimmed = line.trimStart();
    if (!/^-\s*\{/u.test(trimmed)) continue;

    const mappingLines = [trimmed];
    let cursor = lineIndex;
    let braceDepth = flowBraceDelta(trimmed);

    while (braceDepth > 0 && cursor + 1 < lines.length) {
      cursor += 1;
      const candidate = lines[cursor];
      mappingLines.push(candidate.trim());
      braceDepth += flowBraceDelta(candidate);
    }

    if (braceDepth !== 0) {
      throw new Error(`${path} contains an unterminated flow-style step mapping`);
    }

    const flowMapping = mappingLines.join('\n');
    if (
      /(?:\buses|'uses'|"uses")\s*:\s*['"]?actions\/(?:checkout|setup-node)@/iu.test(
        flowMapping,
      )
    ) {
      throw new Error(
        `${path} uses a flow-style checkout/setup-node step that bypasses direct step authority validation`,
      );
    }
  }
}

describe('Node 24 action flow-style authority', () => {
  it('keeps persistent checkout/setup-node steps in block mappings', () => {
    for (const path of workflowPaths) {
      expect(() =>
        expectNoFlowStyleReviewedActionSteps(
          path,
          readFileSync(resolve(repositoryRoot, path), 'utf8'),
        ),
      ).not.toThrow();
    }
  });

  it('rejects a one-line flow-style checkout step', () => {
    const hostileWorkflow = [
      'jobs:',
      '  scan:',
      '    steps:',
      '      - name: Reviewed checkout',
      '        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      '        env:',
      "          GIT_CONFIG_COUNT: '1'",
      '          GIT_CONFIG_KEY_0: init.defaultBranch',
      '          GIT_CONFIG_VALUE_0: main',
      '      - { uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 }',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectNoFlowStyleReviewedActionSteps(
        'hostile-flow-checkout.yml',
        hostileWorkflow,
      ),
    ).toThrow(/flow-style checkout\/setup-node/u);
  });

  it('rejects quoted uses keys in flow-style checkout steps', () => {
    const hostileWorkflow = [
      'jobs:',
      '  scan:',
      '    steps:',
      "      - { 'uses': actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 }",
      '      - { "uses": actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 }',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectNoFlowStyleReviewedActionSteps(
        'hostile-quoted-flow-uses-key.yml',
        hostileWorkflow,
      ),
    ).toThrow(/flow-style checkout\/setup-node/u);
  });

  it('rejects a multi-line quoted flow-style setup-node step', () => {
    const hostileWorkflow = [
      'jobs:',
      '  scan:',
      '    steps:',
      '      - {',
      "          uses: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',",
      "          with: { 'node-version': '24' }",
      '        }',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectNoFlowStyleReviewedActionSteps(
        'hostile-flow-setup-node.yml',
        hostileWorkflow,
      ),
    ).toThrow(/flow-style checkout\/setup-node/u);
  });

  it('does not stop at a nested flow mapping before the uses authority', () => {
    const hostileWorkflow = [
      'jobs:',
      '  scan:',
      '    steps:',
      '      - {',
      '          with: { fetch-depth: 1 },',
      '          uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      '        }',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectNoFlowStyleReviewedActionSteps(
        'hostile-nested-flow-before-uses.yml',
        hostileWorkflow,
      ),
    ).toThrow(/flow-style checkout\/setup-node/u);
  });

  it('ignores flow-style action text inside a shell block scalar', () => {
    const benignWorkflow = [
      'jobs:',
      '  scan:',
      '    steps:',
      '      - run: |',
      '          echo "- { uses: actions/checkout@deadbeef }"',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectNoFlowStyleReviewedActionSteps(
        'block-scalar-decoy.yml',
        benignWorkflow,
      ),
    ).not.toThrow();
  });
});
