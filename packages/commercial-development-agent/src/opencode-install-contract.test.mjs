import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKSPACE_PATH = resolve(
  import.meta.dirname,
  '../../../pnpm-workspace.yaml',
);
const LOCKFILE_PATH = resolve(import.meta.dirname, '../../../pnpm-lock.yaml');
const PACKAGE_PATH = resolve(import.meta.dirname, '../package.json');

const workspace = readFileSync(WORKSPACE_PATH, 'utf8');
const lockfile = readFileSync(LOCKFILE_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));

function parseTopLevelYamlSequence(document, key) {
  const lines = document.replace(/\r\n?/gu, '\n').split('\n');
  const headerIndex = lines.findIndex((line) => line === `${key}:`);
  if (headerIndex === -1) {
    throw new Error(`Missing required YAML sequence: ${key}`);
  }

  const values = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (line.length === 0) {
      continue;
    }
    if (!line.startsWith(' ')) {
      break;
    }

    const item = /^  -\s+([^#]+?)\s*$/u.exec(line);
    if (!item) {
      throw new Error(`Unsupported ${key} YAML entry: ${line}`);
    }
    values.push(item[1].trim());
  }

  return values;
}

describe('dependency installation boundary', () => {
  it('allows only reviewed exact dependencies to run install lifecycle scripts', () => {
    expect(packageJson.devDependencies['opencode-ai']).toBe('1.18.9');
    expect(lockfile).toContain('\n  esbuild@0.28.1:\n');
    expect(
      parseTopLevelYamlSequence(workspace, 'onlyBuiltDependencies').sort(),
    ).toEqual(['esbuild', 'opencode-ai']);
    expect(workspace).not.toContain('ignoredBuiltDependencies');
    expect(workspace).not.toContain('dangerouslyAllowAllBuilds');
  });
});
