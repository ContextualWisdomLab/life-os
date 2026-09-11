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
  for (const match of workflow.matchAll(/actions\/checkout@([0-9a-f]{40})/g)) {
    expect(match[0], path).toBe(checkoutNode24);
  }
  for (const match of workflow.matchAll(/actions\/setup-node@([0-9a-f]{40})/g)) {
    expect(match[0], path).toBe(setupNode24);
  }
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

  it('preserves AppGuardrail steps at the scan job boundary', () => {
    const appguardrail = workflows['.github/workflows/appguardrail.yml'];
    const stepsLines = appguardrail
      .split(String.fromCharCode(10))
      .filter((line) => line.trim() === 'steps:');
    expect(stepsLines).toContain('    steps:');
    expect(stepsLines).not.toContain('        steps:');
  });
});
