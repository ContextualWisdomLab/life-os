import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('./main.ts', import.meta.url)),
  'utf8',
);

/** Counts stable route-authority tokens in the Habit controller source. */
function count(pattern: RegExp): number {
  return [...CONTROLLER_SOURCE.matchAll(pattern)].length;
}

describe('HabitController workspace authority contract', () => {
  it('never binds a bare client-selected workspace header', () => {
    expect(count(/@Headers\(['"]x-workspace-id['"]\)/gu)).toBe(0);
    expect(CONTROLLER_SOURCE).not.toContain('requireWorkspaceId(');
  });

  it('binds all five workspace-scoped routes to signed context verification', () => {
    expect(count(/@Headers\(['"]x-life-os-workspace-id['"]\)/gu)).toBe(5);
    expect(count(/@Headers\(['"]x-life-os-context-issued-at['"]\)/gu)).toBe(5);
    expect(count(/@Headers\(['"]x-life-os-context-signature['"]\)/gu)).toBe(5);
    expect(CONTROLLER_SOURCE.match(/requireTrustedWorkspaceContext\(/gu)).toHaveLength(5);
  });
});
