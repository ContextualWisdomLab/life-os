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

describe('model timeout and gateway diagnostic authority', () => {
  it('does not impose elapsed-time termination or fixed provider request timeouts on model work', () => {
    const modelStep = namedStep(workflow, 'Run one bounded OpenCode implementation');
    const workspaceStep = namedStep(workflow, 'Prepare disposable model workspace');

    expect(modelStep).not.toMatch(/\btimeout\b[^\n]*\bopencode\s+run\b/u);
    expect(workspaceStep).not.toContain("'timeout':");
    expect(workspaceStep).not.toContain("'chunkTimeout':");
    expect(workflow).toContain('timeout-minutes: 120');
  });

  it('does not retain or replay raw contextual-orchestrator gateway output', () => {
    const gatewayStep = namedStep(
      workflow,
      'Start contextual-orchestrator free gateway',
    );

    expect(gatewayStep).not.toContain('orchestrator-gateway.log');
    expect(gatewayStep).not.toMatch(/\btail\b/u);
    expect(gatewayStep).toContain('</dev/null >/dev/null 2>&1 &');
  });
});
