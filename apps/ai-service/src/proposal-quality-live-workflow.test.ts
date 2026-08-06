import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  __dirname,
  '../../../.github/workflows/ai-proposal-live-conformance.yml',
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const ORCHESTRATOR_COMMIT = '6841b71935e0b7cb98fb52bcb4709cc5100c8d87';
const TEMPORARY_REPAIR_PATHS = [
  resolve(
    __dirname,
    '../../../.github/workflows/apply-ai-live-review-fixes.yml',
  ),
  resolve(__dirname, '../../../.github/scripts/apply-ai-live-review-fixes.py'),
  resolve(
    __dirname,
    '../../../.github/scripts/augment-ai-live-review-fixes.py',
  ),
];

/** Returns one named workflow step including its body but not the next step. */
function step(name: string): string {
  const marker = `      - name: ${name}\n`;
  const start = workflow.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = workflow.indexOf('\n      - name: ', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

describe('NVIDIA NIM live conformance workflow contract', () => {
  it('runs hourly and manually with least-privilege single-flight execution', () => {
    expect(workflow).toContain("    - cron: '47 * * * *'");
    expect(workflow).toContain('  workflow_dispatch:');
    expect(workflow).not.toContain('  pull_request:');
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain(
      'group: ai-proposal-live-conformance-${{ github.repository }}',
    );
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain('timeout-minutes: 120');
  });

  it('pins every external action and uses one orchestrator commit source', () => {
    const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/gu)].map(
      (match) => match[1] ?? '',
    );
    expect(uses.length).toBeGreaterThanOrEqual(5);
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
      'actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97',
    );
    expect(workflow).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    );
    const commitMatches = workflow.match(new RegExp(ORCHESTRATOR_COMMIT, 'gu'));
    expect(commitMatches).toHaveLength(1);
    expect(workflow).toContain(
      'ref: ${{ env.CONTEXTUAL_ORCHESTRATOR_COMMIT }}',
    );
    expect(workflow).toContain(
      'CONTEXTUAL_ORCHESTRATOR_COMMIT_SHA: ${{ env.CONTEXTUAL_ORCHESTRATOR_COMMIT }}',
    );
    expect(step('Verify contextual-orchestrator identity')).toContain(
      'git -C _contextual_orchestrator rev-parse HEAD',
    );
    expect(
      workflow.indexOf('Verify contextual-orchestrator identity'),
    ).toBeLessThan(
      workflow.indexOf('Install pinned contextual-orchestrator dependencies'),
    );
    expect(
      step('Install pinned contextual-orchestrator dependencies'),
    ).toContain('--require-hashes');
    expect(
      step('Install pinned contextual-orchestrator dependencies'),
    ).toContain('_contextual_orchestrator/requirements.lock');
    expect(
      step('Install pinned contextual-orchestrator dependencies'),
    ).not.toContain('--no-deps');
    expect(
      step('Install pinned contextual-orchestrator dependencies'),
    ).not.toContain('./_contextual_orchestrator');
  });

  it('uses only the NVIDIA credential and scopes its secret to one seed step', () => {
    const prohibitedToken = ['COPILOT', 'GITHUB', 'TOKEN'].join('_');
    expect(workflow).not.toContain(prohibitedToken);
    const secretExpression = '${{ secrets.NVIDIA_NIM_API_KEY }}';
    const secretMatches = workflow.match(
      /\$\{\{ secrets\.NVIDIA_NIM_API_KEY \}\}/gu,
    );
    expect(secretMatches).toHaveLength(1);
    const seed = step(
      'Seed NVIDIA credential through the encrypted KV bootstrap',
    );
    expect(seed).toContain(secretExpression);
    expect(seed).toContain('register-credential');
    expect(seed).toContain('--name NVIDIA_NIM_API_KEY');
    expect(seed).toContain('--value-stdin');
    expect(seed).toContain("printf '%s'");
    expect(workflow.replace(seed, '')).not.toContain(secretExpression);
    expect(step('Start the loopback contextual-orchestrator')).not.toContain(
      secretExpression,
    );
    expect(
      step('Generate credential-free live conformance evidence'),
    ).not.toContain(secretExpression);
  });

  it('fixes provider egress and keeps credentials out of process arguments', () => {
    expect(workflow).toContain(
      'PROVIDER_BASE_URL: https://integrate.api.nvidia.com/v1',
    );
    expect(workflow).toContain(
      'PROVIDER_ALLOWED_HOST: integrate.api.nvidia.com',
    );
    expect(workflow).toContain(
      "'CONTEXTUAL_ORCHESTRATOR_ALLOWED_PROVIDER_HOSTS'",
    );
    const server = step('Start the loopback contextual-orchestrator');
    expect(server).toContain('working-directory: _contextual_orchestrator');
    expect(server).toContain('--host 127.0.0.1');
    expect(server).toContain('--port 8765');
    expect(server).not.toContain('--inference-token');
    expect(server).not.toContain('--admin-token');
    expect(server).toContain('--budget-max-output-tokens 200000');
    expect(server).not.toContain('--allow-public-bind');
    expect(workflow).toContain("'CONTEXTUAL_ORCHESTRATOR_INFERENCE_TOKEN'");
    expect(workflow).toContain("'CONTEXTUAL_ORCHESTRATOR_ADMIN_TOKEN'");
    expect(workflow).toContain(
      "'CONTEXTUAL_ORCHESTRATOR_LIVE_URL': 'http://127.0.0.1:8765'",
    );
  });

  it('retains only the validated credential-free report artifact', () => {
    const generation = step(
      'Generate credential-free live conformance evidence',
    );
    expect(generation).toContain(
      'PROPOSAL_LIVE_REPORT_PATH: ${{ runner.temp }}/ai-proposal-live-conformance.json',
    );
    expect(generation).toContain(
      'pnpm --filter @life-os/ai-service quality:live',
    );
    const validation = step('Validate retained live report');
    expect(validation).toContain('validateProposalLiveConformanceReport');
    const upload = step('Upload credential-free live conformance report');
    expect(upload).toContain(
      'path: ${{ runner.temp }}/ai-proposal-live-conformance.json',
    );
    expect(upload).toContain('if-no-files-found: error');
    expect(upload).toContain('retention-days: 14');
    expect(upload).not.toContain('contextual-orchestrator.log');
    expect(upload).not.toContain('nvidia-nim-agents.json');
    expect(upload).not.toContain('temporary');
    expect(step('Stop the ephemeral orchestrator')).toContain(
      'rm -f "${RUNNER_TEMP}/contextual-orchestrator.log"',
    );
  });

  it('does not retain write-capable one-shot repair machinery', () => {
    for (const path of TEMPORARY_REPAIR_PATHS) {
      expect(existsSync(path), path).toBe(false);
    }
  });

  it('runs deterministic contract tests before any provider traffic', () => {
    const deterministic = step('Verify deterministic live-evidence contracts');
    for (const testFile of [
      'contextual-orchestrator-proposal-contract.test.ts',
      'contextual-orchestrator-live-model.test.ts',
      'proposal-quality-live-conformance.test.ts',
      'proposal-quality-live-command.test.ts',
      'proposal-quality-live-cli.test.ts',
      'proposal-quality-live-workflow.test.ts',
    ]) {
      expect(deterministic).toContain(testFile);
    }
    expect(
      workflow.indexOf('Verify deterministic live-evidence contracts'),
    ).toBeLessThan(
      workflow.indexOf(
        'Seed NVIDIA credential through the encrypted KV bootstrap',
      ),
    );
    expect(workflow).toContain(
      'NVIDIA_NIM_API_KEY_AVAILABLE: ${{ steps.seed_nvidia.outputs.available }}',
    );
  });
});
