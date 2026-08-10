import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const controllerSource = readFileSync(resolve(__dirname, 'main.ts'), 'utf8');

describe('Integration event tenant authority contract', () => {
  it('never accepts the legacy browser-selectable workspace header', () => {
    expect(controllerSource).not.toContain("@Headers('x-workspace-id')");
    expect(controllerSource).toContain("@Headers('x-life-os-workspace-id')");
    expect(controllerSource).toContain("@Headers('x-life-os-context-issued-at')");
    expect(controllerSource).toContain("@Headers('x-life-os-context-signature')");
    expect(controllerSource).toContain('INTEGRATION_GATEWAY_CONTEXT_SECRET');
    expect(controllerSource).toContain('requireTrustedWorkspaceContext(');
  });
});
