import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const controllerSource = readFileSync(
  resolve(import.meta.dirname, 'main.ts'),
  'utf8',
);

describe('Review controller tenant authority contract', () => {
  it('rejects browser-selectable workspace authority on every review route', () => {
    expect(controllerSource).not.toContain("@Headers('x-workspace-id')");
    expect(controllerSource).not.toContain('requireWorkspaceHeader(');
    expect(controllerSource.match(/@Headers\('x-life-os-workspace-id'\)/gu)).toHaveLength(4);
    expect(controllerSource.match(/@Headers\('x-life-os-context-issued-at'\)/gu)).toHaveLength(4);
    expect(controllerSource.match(/@Headers\('x-life-os-context-signature'\)/gu)).toHaveLength(4);
    expect(controllerSource.match(/requireTrustedWorkspaceContext\(/gu)).toHaveLength(4);
    expect(controllerSource).toContain('process.env.REVIEW_GATEWAY_CONTEXT_SECRET');
  });
});
