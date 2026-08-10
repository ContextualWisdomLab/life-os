import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CONTROLLER_SOURCE = readFileSync(
  fileURLToPath(new URL('./main.ts', import.meta.url)),
  'utf8',
);

const LEGACY_WORKSPACE_HEADER = /@Headers\(['"]x-workspace-id['"]\)/gu;
const TRUSTED_WORKSPACE_HEADER =
  /@Headers\(['"]x-life-os-workspace-id['"]\)/gu;
const TRUSTED_ISSUED_AT_HEADER =
  /@Headers\(['"]x-life-os-context-issued-at['"]\)/gu;
const TRUSTED_SIGNATURE_HEADER =
  /@Headers\(['"]x-life-os-context-signature['"]\)/gu;

/** Counts stable route-boundary tokens in the Planning controller source. */
function count(pattern: RegExp): number {
  return [...CONTROLLER_SOURCE.matchAll(pattern)].length;
}

describe('PlanningController workspace authority contract', () => {
  it('never accepts a bare client-selected workspace header', () => {
    expect(count(LEGACY_WORKSPACE_HEADER)).toBe(0);
    expect(CONTROLLER_SOURCE).not.toContain('function requireWorkspaceId');
  });

  it('binds every workspace-scoped planning route to the signed workspace context', () => {
    // search + Today GET/PUT + six Goal/Project/Task routes.
    expect(count(TRUSTED_WORKSPACE_HEADER)).toBe(9);
    expect(count(TRUSTED_ISSUED_AT_HEADER)).toBe(9);
    expect(count(TRUSTED_SIGNATURE_HEADER)).toBe(9);
    expect(CONTROLLER_SOURCE.match(/requireTrustedWorkspaceContext\(/gu)).toHaveLength(9);
  });
});
