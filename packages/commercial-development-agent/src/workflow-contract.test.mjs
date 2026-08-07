import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-commercial-development.yml',
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

/** Returns one named workflow step including its body but not the next step. */
function step(name) {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = workflow.indexOf('\n      - name: ', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

describe('OpenCode commercial development workflow contract', () => {
  it('runs hourly and manually with one bounded single-flight job', () => {
    expect(workflow).toContain("    - cron: '11 * * * *'");
    expect(workflow).toContain('  workflow_dispatch:');
    expect(workflow).not.toContain('pull_request_target');
    expect(workflow).toContain('permissions: {}');
    expect(workflow).toContain(
      'group: opencode-commercial-development-${{ github.repository }}',
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes: 120');
  });

  it('pins every external action and one exact OpenCode package version', () => {
    const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(
      (match) => match[1] ?? '',
    );
    expect(uses.length).toBeGreaterThanOrEqual(3);
    for (const action of uses) {
      expect(action).toMatch(/^[^@\s]+@[0-9a-f]{40}$/u);
    }
    expect(workflow).toContain(
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    );
    expect(workflow).toContain(
      'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020',
    );
    expect(workflow).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    expect(workflow).toMatch(/OPENCODE_PACKAGE_VERSION: '[0-9]+\.[0-9]+\.[0-9]+'/u);
    expect(workflow).not.toContain('__PINNED_BY_BOOTSTRAP__');
    expect(step('Verify the exact OpenCode installation')).toContain(
      'opencode --version',
    );
    expect(step('Verify the exact OpenCode installation')).toContain(
      'opencode run --help',
    );
    expect(workflow).not.toMatch(/curl[^\n]*\|\s*(?:sh|bash)/iu);
  });

  it('uses only the NVIDIA secret and never exposes GitHub credentials to OpenCode', () => {
    expect(workflow).not.toContain('COPILOT_GITHUB_TOKEN');
    const secretExpression = '${{ secrets.NVIDIA_NIM_API_KEY }}';
    expect(
      workflow.match(/\$\{\{ secrets\.NVIDIA_NIM_API_KEY \}\}/gu),
    ).toHaveLength(1);
    const model = step('Run one bounded OpenCode implementation');
    expect(model).toContain(secretExpression);
    expect(model).toContain('NVIDIA_API_KEY="$NVIDIA_NIM_API_KEY"');
    expect(model).toContain('unset NVIDIA_NIM_API_KEY');
    expect(model).toContain('opencode run');
    expect(model).toContain('timeout --signal=TERM --kill-after=30s 90m');
    expect(model).not.toContain('GITHUB_TOKEN');
    expect(model).not.toContain('GH_TOKEN');
    expect(model).not.toContain('github.token');
    expect(model).not.toContain('secrets.');
    expect(model).not.toContain('review');
    expect(step('Checkout exact main source')).toContain(
      'persist-credentials: false',
    );
  });

  it('keeps deterministic selection, branch, diff, and base policy outside the model', () => {
    expect(
      workflow.indexOf('Run deterministic commercial readiness audit'),
    ).toBeLessThan(workflow.indexOf('Run one bounded OpenCode implementation'));
    expect(step('Select one eligible issue')).toContain(
      'commercial-development-agent select',
    );
    expect(step('Create the isolated UUIDv4 feature branch')).toContain(
      'uuid.uuid4()',
    );
    expect(step('Create the isolated UUIDv4 feature branch')).toContain(
      'automation/opencode-commercial-',
    );
    expect(step('Build the policy-isolated prompt')).toContain(
      'commercial-development-agent prompt',
    );
    expect(step('Project and validate the working-tree diff')).toContain(
      'commercial-development-agent validate-diff',
    );
    expect(step('Recheck the exact main base before remote mutation')).toContain(
      'git ls-remote origin refs/heads/main',
    );
    expect(step('Recheck the exact main base before remote mutation')).toContain(
      'base_changed',
    );
  });

  it('allows one credentialed draft-PR mutation step but no merge or release authority', () => {
    const mutation = step('Commit, push, and open one draft pull request');
    expect(mutation).toContain('GH_TOKEN: ${{ github.token }}');
    expect(mutation).toContain('git commit');
    expect(mutation).toContain('git push origin');
    expect(mutation).toContain('gh pr create');
    expect(mutation).toContain('--draft');
    expect(mutation).not.toContain('gh pr merge');
    expect(mutation).not.toContain('--admin');
    expect(mutation).not.toContain('gh release');
    expect(mutation).not.toContain('git tag');
    expect(workflow).not.toContain('deployments: write');
    expect(workflow).not.toContain('environments: write');
    expect(workflow).not.toContain('actions: write');
  });

  it('retains only the credential-free receipt and always removes private model material', () => {
    const upload = step('Upload credential-free development receipt');
    expect(upload).toContain('path: ${{ runner.temp }}/commercial-development/receipt.json');
    expect(upload).toContain('if-no-files-found: error');
    expect(upload).toContain('retention-days: 7');
    for (const prohibited of ['prompt.json', 'opencode.log', 'opencode.json', 'diff.json']) {
      expect(upload).not.toContain(prohibited);
    }
    const cleanup = step('Remove private agent material');
    expect(cleanup).toContain('if: always()');
    for (const file of [
      'prompt.json',
      'prompt.txt',
      'opencode.json',
      'opencode.log',
      'issues.json',
      'pulls.json',
      'diff.json',
      'receipt-input.json',
    ]) {
      expect(cleanup).toContain(file);
    }
  });
});
