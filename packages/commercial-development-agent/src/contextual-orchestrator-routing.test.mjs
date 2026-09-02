import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-commercial-development.yml',
);
const SIDECAR_PATH = resolve(
  import.meta.dirname,
  '../../../scripts/ci/lifeos_contextual_orchestrator_sidecar.sh',
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const sidecar = readFileSync(SIDECAR_PATH, 'utf8');

function namedStep(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n      - name: ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('OpenCode commercial development orchestration boundary', () => {
  it('routes model traffic through the pinned contextual-orchestrator free pool', () => {
    expect(sidecar).toContain(
      "readonly ORCHESTRATOR_PIN_SHA='045d17da5e2aea56a97e241ee158ab1628d78660'",
    );
    expect(sidecar).toContain("readonly ORCHESTRATOR_ROUTE='orchestrator/free'");
    expect(sidecar).toContain('--auto-discover-model-agents');
    expect(sidecar).toContain('--auth-token-key CONTEXTUAL_ORCHESTRATOR_TOKEN');
    expect(workflow).toContain('contextual_orchestrator_gateway/orchestrator/free');
    expect(workflow).toContain('CONTEXTUAL_ORCHESTRATOR_TOKEN');
    expect(workflow).toContain('http://127.0.0.1:');
    expect(workflow).toContain("LIFEOS_ORCHESTRATOR_GATEWAY_PORT: '8000'");
  });

  it('scopes every governed provider credential to gateway bootstrap only', () => {
    const gatewayStep = namedStep(
      workflow,
      'Start contextual-orchestrator free gateway',
    );
    const modelStep = namedStep(workflow, 'Run one bounded OpenCode implementation');

    for (const secret of [
      'BYTEZ_API_KEY',
      'NVIDIA_NIM_API_KEY',
      'NVIDIA_NIM_API_KEY_SUB',
      'OPENROUTER_API_KEY',
      'OPENAI_API_KEY',
    ]) {
      const mapping = `secrets.${secret}`;
      expect(gatewayStep).toContain(mapping);
      expect(modelStep).not.toContain(mapping);
      expect(workflow.split(mapping)).toHaveLength(2);
      expect(sidecar).toContain(secret);
    }
  });

  it('does not retain the direct NVIDIA provider bridge or direct-provider model configuration', () => {
    expect(workflow).not.toContain('integrate.api.nvidia.com');
    expect(workflow).not.toContain('NIM_BRIDGE_PORT');
    expect(workflow).not.toContain("'enabled_providers': ['nvidia']");
    expect(workflow).not.toContain('opencode models nvidia');
    expect(workflow).not.toContain('NVIDIA_API_KEY=local-loopback-placeholder');
    expect(sidecar).not.toContain('integrate.api.nvidia.com');
  });
});
