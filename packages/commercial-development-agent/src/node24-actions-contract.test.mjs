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
const workflows = Object.fromEntries(
  workflowPaths.map((path) => [
    path,
    readFileSync(resolve(repositoryRoot, path), 'utf8'),
  ]),
);
const checkoutNode24 =
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';
const setupNode24 =
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020';
const checkoutNode20 =
  'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const setupNode20 =
  'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';

function expectReviewedActionPins(path, workflow) {
  expect(workflow, path).not.toContain(checkoutNode20);
  expect(workflow, path).not.toContain(setupNode20);
  expect(workflow, path).not.toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24');
  for (const match of workflow.matchAll(/actions\/checkout@([^\s"'#]+)/g)) {
    expect(match[0], path).toBe(checkoutNode24);
  }
  for (const match of workflow.matchAll(/actions\/setup-node@([^\s"'#]+)/g)) {
    expect(match[0], path).toBe(setupNode24);
  }
}

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

function isDirectStepUses(lines, lineIndex, reviewedAction) {
  if (isInsideBlockScalar(lines, lineIndex)) return false;

  const line = lines[lineIndex];
  const trimmed = line.trimStart();
  const authority = `uses: ${reviewedAction}`;
  if (trimmed !== authority && !trimmed.startsWith(`${authority} #`)) {
    return false;
  }

  const usesIndent = lineIndent(line);
  if (usesIndent < 2) return false;
  const stepIndent = usesIndent - 2;

  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const candidate = lines[index];
    if (candidate.trim() === '') continue;
    const candidateIndent = lineIndent(candidate);
    if (candidateIndent < stepIndent) return false;
    if (candidateIndent === stepIndent) {
      return candidate.trimStart().startsWith('- ');
    }
  }

  return false;
}

function expectCheckoutInitialBranchAuthority(path, workflow) {
  const lines = workflow.split(String.fromCharCode(10));
  const checkoutLineIndexes = lines.flatMap((line, index) =>
    isDirectStepUses(lines, index, checkoutNode24) ? [index] : [],
  );

  expect(checkoutLineIndexes.length, `${path} checkout count`).toBeGreaterThan(
    0,
  );

  for (const checkoutLineIndex of checkoutLineIndexes) {
    const checkoutLine = lines[checkoutLineIndex];
    const usesIndent = lineIndent(checkoutLine);
    const stepIndent = Math.max(0, usesIndent - 2);
    let stepEnd = lines.length;

    for (let index = checkoutLineIndex + 1; index < lines.length; index += 1) {
      const candidate = lines[index];
      if (candidate.trim() === '') continue;
      const candidateIndent = lineIndent(candidate);
      if (
        candidateIndent === stepIndent &&
        candidate.trimStart().startsWith('- ')
      ) {
        stepEnd = index;
        break;
      }
    }

    const stepLines = lines.slice(checkoutLineIndex, stepEnd);
    const envIndent = ' '.repeat(usesIndent);
    const entryIndent = ' '.repeat(usesIndent + 2);
    expect(
      stepLines.filter((line) => line === `${envIndent}env:`),
      `${path} checkout env`,
    ).toHaveLength(1);
    expect(
      stepLines.filter(
        (line) => line === `${entryIndent}GIT_CONFIG_COUNT: '1'`,
      ),
      `${path} checkout git config count`,
    ).toHaveLength(1);
    expect(
      stepLines.filter(
        (line) => line === `${entryIndent}GIT_CONFIG_KEY_0: init.defaultBranch`,
      ),
      `${path} checkout git config key`,
    ).toHaveLength(1);
    expect(
      stepLines.filter(
        (line) => line === `${entryIndent}GIT_CONFIG_VALUE_0: main`,
      ),
      `${path} checkout git config value`,
    ).toHaveLength(1);
  }
}

function expectAppGuardrailScanSteps(workflow) {
  const stepsLines = workflow
    .split(String.fromCharCode(10))
    .filter((line) => line.trim() === 'steps:');
  expect(stepsLines).toContain('    steps:');
  expect(stepsLines).not.toContain('        steps:');
}

describe('persistent GitHub Action runtime authority', () => {
  it('uses reviewed Node 24 action pins without a runtime-forcing compatibility switch', () => {
    for (const [path, workflow] of Object.entries(workflows)) {
      expectReviewedActionPins(path, workflow);
    }
  });

  it('rejects floating or otherwise unreviewed checkout/setup-node refs', () => {
    const hostileWorkflow = [
      'steps:',
      '  - uses: actions/checkout@v7',
      '  - uses: actions/setup-node@main',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectReviewedActionPins('hostile-floating-ref.yml', hostileWorkflow),
    ).toThrow();
  });

  it('configures every persistent checkout git init to use main explicitly', () => {
    for (const [path, workflow] of Object.entries(workflows)) {
      expectCheckoutInitialBranchAuthority(path, workflow);
    }
  });

  it('rejects a scalar env payload impersonating checkout Git config authority', () => {
    const hostileWorkflow = [
      'steps:',
      '  - name: Hostile checkout',
      `    uses: ${checkoutNode24}`,
      '    env: |',
      "      GIT_CONFIG_COUNT: '1'",
      '      GIT_CONFIG_KEY_0: init.defaultBranch',
      '      GIT_CONFIG_VALUE_0: main',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectCheckoutInitialBranchAuthority(
        'hostile-scalar-env.yml',
        hostileWorkflow,
      ),
    ).toThrow();
  });

  it('rejects a block scalar impersonating an executable checkout step', () => {
    const hostileWorkflow = [
      'steps:',
      '  - name: Hostile shell scalar',
      '    run: |',
      `      uses: ${checkoutNode24}`,
      '      env:',
      "        GIT_CONFIG_COUNT: '1'",
      '        GIT_CONFIG_KEY_0: init.defaultBranch',
      '        GIT_CONFIG_VALUE_0: main',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectCheckoutInitialBranchAuthority(
        'hostile-scalar-checkout.yml',
        hostileWorkflow,
      ),
    ).toThrow();
  });

  it('rejects a nested scalar sequence impersonating a checkout step boundary', () => {
    const hostileWorkflow = [
      'steps:',
      '  - name: Hostile shell scalar',
      '    run: |',
      '      - fake checkout',
      `        uses: ${checkoutNode24}`,
      '        env:',
      "          GIT_CONFIG_COUNT: '1'",
      '          GIT_CONFIG_KEY_0: init.defaultBranch',
      '          GIT_CONFIG_VALUE_0: main',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectCheckoutInitialBranchAuthority(
        'hostile-nested-scalar-checkout.yml',
        hostileWorkflow,
      ),
    ).toThrow();
  });

  it('rejects a non-steps sequence impersonating an executable checkout step', () => {
    const hostileWorkflow = [
      'jobs:',
      '  scan:',
      '    decoy:',
      '      - name: Fake checkout',
      `        uses: ${checkoutNode24}`,
      '        env:',
      "          GIT_CONFIG_COUNT: '1'",
      '          GIT_CONFIG_KEY_0: init.defaultBranch',
      '          GIT_CONFIG_VALUE_0: main',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectCheckoutInitialBranchAuthority(
        'hostile-non-steps-sequence.yml',
        hostileWorkflow,
      ),
    ).toThrow();
  });

  it('rejects conflicting duplicate checkout Git configuration keys', () => {
    const hostileWorkflow = [
      'steps:',
      '  - name: Hostile checkout',
      `    uses: ${checkoutNode24}`,
      '    env:',
      "      GIT_CONFIG_COUNT: '1'",
      '      GIT_CONFIG_KEY_0: init.defaultBranch',
      '      GIT_CONFIG_VALUE_0: main',
      '      GIT_CONFIG_VALUE_0: master',
    ].join(String.fromCharCode(10));

    expect(() =>
      expectCheckoutInitialBranchAuthority(
        'hostile-duplicate-git-config.yml',
        hostileWorkflow,
      ),
    ).toThrow();
  });

  it('preserves AppGuardrail steps at the scan job boundary', () => {
    expectAppGuardrailScanSteps(workflows['.github/workflows/appguardrail.yml']);
  });

  it('rejects AppGuardrail steps owned only by a sibling job', () => {
    const hostileWorkflow = [
      'jobs:',
      '  scan:',
      '    permissions:',
      '      contents: read',
      '  decoy:',
      '    steps:',
      '      - run: echo decoy',
    ].join(String.fromCharCode(10));

    expect(() => expectAppGuardrailScanSteps(hostileWorkflow)).toThrow();
  });
});
