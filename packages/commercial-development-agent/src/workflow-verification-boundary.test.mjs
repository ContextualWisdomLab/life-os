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

describe('generated-code verification trust boundary', () => {
  it('keeps Docker daemon access in the trusted runner while product checks stay isolated', () => {
    const verification = step('Verify the accepted repository change');

    expect(verification).toContain('set -Eeuo pipefail');
    expect(verification).toContain('sudo -u opencode_model env -i');
    expect(verification).toContain(
      `bash -c 'cd "$1" && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build'`,
    );
    expect(verification).not.toContain(
      'pnpm build && docker compose config',
    );
    expect(verification).toContain('cd "$MODEL_WORKSPACE"');
    expect(verification).toContain('docker compose config > /dev/null');

    const isolatedStart = verification.indexOf('sudo -u opencode_model env -i');
    const isolatedEnd = verification.indexOf('status=$?');
    const composeStart = verification.indexOf('docker compose config > /dev/null');
    expect(isolatedStart).toBeGreaterThanOrEqual(0);
    expect(isolatedEnd).toBeGreaterThan(isolatedStart);
    expect(composeStart).toBeGreaterThan(isolatedEnd);
  });
});
