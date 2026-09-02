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

describe('OpenCode identity command regression boundary', () => {
  it('keeps version, top-level help, and run help inside the reviewed verifier', () => {
    const verification = namedStep(
      workflow,
      'Verify the exact OpenCode installation',
    );
    const directIdentityCommand =
      /\b(?:pnpm[^\n]*\bexec(?:\s+--)?\s+)?opencode\s+(?:--(?:version|help)|run\s+--help)\b/u;

    expect(verification).toContain(
      'node packages/commercial-development-agent/src/verify-opencode-identity.mjs',
    );
    expect(verification).not.toMatch(directIdentityCommand);
    expect('pnpm exec opencode --version').toMatch(directIdentityCommand);
    expect('pnpm exec -- opencode --help').toMatch(directIdentityCommand);
    expect('pnpm exec opencode run --help').toMatch(directIdentityCommand);
  });
});
