import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKSPACE_PATH = resolve(import.meta.dirname, '../../../pnpm-workspace.yaml');
const PACKAGE_PATH = resolve(import.meta.dirname, '../package.json');

const workspace = readFileSync(WORKSPACE_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));

describe('OpenCode installation boundary', () => {
  it('allows only the reviewed exact OpenCode dependency to run install lifecycle scripts', () => {
    expect(packageJson.devDependencies['opencode-ai']).toMatch(
      /^[0-9]+\.[0-9]+\.[0-9]+$/u,
    );
    expect(workspace).toContain('onlyBuiltDependencies:\n  - opencode-ai\n');
    expect(workspace).not.toContain('dangerouslyAllowAllBuilds');
    expect(workspace).not.toContain('  - esbuild\n');
  });
});
