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

describe('OpenCode identity workflow boundary', () => {
  it('allows only the reviewed verifier rather than direct CLI identity probes', () => {
    const verify = namedStep(workflow, 'Verify the exact OpenCode installation');
    const forbidden =
      /\b(?:pnpm[^\n]*\bexec(?:\s+--)?\s+)?opencode\s+(?:--(?:version|help)|run\s+--help)\b/u;

    expect(verify).toContain(
      'node packages/commercial-development-agent/src/verify-opencode-identity.mjs',
    );
    expect(verify).toContain('unset NODE_OPTIONS');
    expect(verify).not.toMatch(forbidden);
    expect('opencode --version').toMatch(forbidden);
    expect('pnpm exec -- opencode --help').toMatch(forbidden);
    expect('pnpm exec -- opencode run --help').toMatch(forbidden);
  });
});
