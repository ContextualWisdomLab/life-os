import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-commercial-development.yml',
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

function namedStep(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n      - name: ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('contextual-orchestrator provider-secret boundary', () => {
  it('maps each governed provider secret exactly once and only into gateway bootstrap', () => {
    const gatewayStep = namedStep(
      workflow,
      'Start contextual-orchestrator free gateway',
    );

    for (const secret of [
      'BYTEZ_API_KEY',
      'NVIDIA_NIM_API_KEY',
      'NVIDIA_NIM_API_KEY_SUB',
      'OPENROUTER_API_KEY',
      'OPENAI_API_KEY',
    ]) {
      const mapping = `secrets.${secret}`;
      expect(gatewayStep).toContain(mapping);
      expect(workflow.split(mapping)).toHaveLength(2);
    }
  });
});
