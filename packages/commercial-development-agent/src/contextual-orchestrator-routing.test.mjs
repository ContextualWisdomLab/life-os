import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-commercial-development.yml',
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

describe('OpenCode commercial development orchestration boundary', () => {
  it('routes model traffic through the pinned contextual-orchestrator free pool', () => {
    expect(workflow).toContain(
      "ORCHESTRATOR_PIN_SHA: '045d17da5e2aea56a97e241ee158ab1628d78660'",
    );
    expect(workflow).toContain('contextual_orchestrator_gateway/orchestrator/free');
    expect(workflow).toContain('CONTEXTUAL_ORCHESTRATOR_TOKEN');
    expect(workflow).toContain('--auto-discover-model-agents');
    expect(workflow).toContain('--auth-token-key CONTEXTUAL_ORCHESTRATOR_TOKEN');
    expect(workflow).toContain('http://127.0.0.1:8000/v1');
  });

  it('bootstraps the governed provider credential set into the gateway boundary', () => {
    for (const secret of [
      'BYTEZ_API_KEY',
      'NVIDIA_NIM_API_KEY',
      'NVIDIA_NIM_API_KEY_SUB',
      'OPENROUTER_API_KEY',
      'OPENAI_API_KEY',
    ]) {
      expect(workflow).toContain(`secrets.${secret}`);
    }
  });

  it('does not retain the direct NVIDIA provider bridge or direct-provider model configuration', () => {
    expect(workflow).not.toContain('integrate.api.nvidia.com');
    expect(workflow).not.toContain('NIM_BRIDGE_PORT');
    expect(workflow).not.toContain("'enabled_providers': ['nvidia']");
    expect(workflow).not.toContain('opencode models nvidia');
    expect(workflow).not.toContain('NVIDIA_API_KEY=local-loopback-placeholder');
  });
});
