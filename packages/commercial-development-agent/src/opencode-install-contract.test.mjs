import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKSPACE_PATH = resolve(
  import.meta.dirname,
  '../../../pnpm-workspace.yaml',
);
const LOCKFILE_PATH = resolve(import.meta.dirname, '../../../pnpm-lock.yaml');
const PACKAGE_PATH = resolve(import.meta.dirname, '../package.json');
const AGENT_VITEST_IMPORTER_PATTERN =
  /^  packages\/commercial-development-agent:\n(?: {4}.*\n| {6}.*\n| {8}.*\n)*? {6}vitest:\n {8}specifier: \^3\.2\.4\n {8}version: 3\.2\.7[^\n]*$/mu;
const VITEST_VITE_DEPENDENCY_PATTERN =
  /^  vitest@3\.2\.7[^:]*:\n(?: {4}.*\n)*? {4}dependencies:\n(?: {6}.*\n)*? {6}vite: 7\.3\.6[^\n]*$/mu;
const VITE_ESBUILD_DEPENDENCY_PATTERN =
  /^  vite@7\.3\.6[^:]*:\n(?: {4}.*\n)*? {4}dependencies:\n(?: {6}.*\n)*? {6}esbuild: 0\.28\.1$/mu;

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
  it('allows only reviewed dependencies to run install lifecycle scripts', () => {
    expect(packageJson.devDependencies['opencode-ai']).toBe('1.18.9');
    expect(
      parseTopLevelYamlSequence(workspace, 'onlyBuiltDependencies'),
    ).toEqual(['opencode-ai', 'esbuild']);
    expect(
      [...workspace.matchAll(/^strictDepBuilds:\s+true$/gmu)],
    ).toHaveLength(1);
    expect(workspace).not.toContain('dangerouslyAllowAllBuilds');
  });

  it('binds the reviewed esbuild script authority to the repository Vitest/Vite path', () => {
    const lockedEsbuildVersions = [
      ...new Set(
        [...lockfile.matchAll(/^  esbuild@([^:\n]+):$/gmu)].map(
          ([, version]) => version,
        ),
      ),
    ].sort();

    expect(packageJson.devDependencies.vitest).toBe('^3.2.4');
    expect(lockedEsbuildVersions).toEqual(['0.28.1']);
    expect(lockfile).toMatch(AGENT_VITEST_IMPORTER_PATTERN);
    expect(lockfile).toMatch(VITEST_VITE_DEPENDENCY_PATTERN);
    expect(lockfile).toMatch(VITE_ESBUILD_DEPENDENCY_PATTERN);
    expect(lockfile).toContain(
      'esbuild@0.28.1:\n    resolution: {integrity: sha512-HrJrvZv5ayxBzPfwphOoNzkzOIIlifzk0KJrGK2c8R4+LKpMtpYLQeUdjnwjWv/LZlkH2laZk+4w78pi99D4Vw==}',
    );
  });

  it('does not borrow esbuild dependency evidence from an adjacent package', () => {
    const hostileLockfile = [
      'snapshots:',
      '  vite@7.3.6:',
      '    resolution: {integrity: sha512-vite}',
      '  unrelated-package@1.0.0:',
      '    dependencies:',
      '      esbuild: 0.28.1',
      '',
    ].join('\n');

    expect(hostileLockfile).not.toMatch(VITE_ESBUILD_DEPENDENCY_PATTERN);
  });

  it('does not accept an orphan reviewed Vite snapshot when Vitest resolves elsewhere', () => {
    const hostileLockfile = [
      'importers:',
      '  packages/commercial-development-agent:',
      '    devDependencies:',
      '      vitest:',
      '        specifier: ^3.2.4',
      '        version: 3.2.7',
      '',
      'snapshots:',
      '  vitest@3.2.7:',
      '    dependencies:',
      '      vite: 7.3.5',
      '  vite@7.3.6:',
      '    dependencies:',
      '      esbuild: 0.28.1',
      '',
    ].join('\n');

    expect(hostileLockfile).toMatch(AGENT_VITEST_IMPORTER_PATTERN);
    expect(hostileLockfile).not.toMatch(VITEST_VITE_DEPENDENCY_PATTERN);
    expect(hostileLockfile).toMatch(VITE_ESBUILD_DEPENDENCY_PATTERN);
  });
});
