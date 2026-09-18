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
  /^  packages\/commercial-development-agent:\n(?: {4}\S[^\n]*\n| {6}\S[^\n]*\n| {8}\S[^\n]*\n)*? {4}devDependencies:\n(?: {6}\S[^\n]*\n| {8}\S[^\n]*\n)*? {6}vitest:\n {8}specifier: \^3\.2\.4\n {8}version: (3\.2\.7(?:\([^\n]*\))?)$/mu;
const VITEST_VITE_DEPENDENCY_PATTERN =
  /^  vitest@3\.2\.7[^:]*:\n(?: {4}.*\n)*? {4}dependencies:\n(?: {6}.*\n)*? {6}vite: 7\.3\.6[^\n]*$/mu;
const VITE_ESBUILD_DEPENDENCY_PATTERN =
  /^  vite@7\.3\.6[^:]*:\n(?: {4}.*\n)*? {4}dependencies:\n(?: {6}.*\n)*? {6}esbuild: 0\.28\.1$/mu;

const workspace = readFileSync(WORKSPACE_PATH, 'utf8');
const lockfile = readFileSync(LOCKFILE_PATH, 'utf8');
const packageJson = JSON.parse(readFileSync(PACKAGE_PATH, 'utf8'));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseSnapshotDependency(document, snapshotIdentity, dependencyName) {
  const pattern = new RegExp(
    `^  ${escapeRegExp(snapshotIdentity)}:\\n` +
      `(?: {4}.*\\n)*? {4}dependencies:\\n` +
      `(?: {6}.*\\n)*? {6}${escapeRegExp(dependencyName)}: ([^\\n]+)$`,
    'mu',
  );
  const match = pattern.exec(document);
  if (!match) {
    throw new Error(
      `Missing ${dependencyName} dependency for snapshot ${snapshotIdentity}`,
    );
  }
  return match[1];
}

function parseAgentVitestVersion(document) {
  const match = AGENT_VITEST_IMPORTER_PATTERN.exec(document);
  if (!match) {
    throw new Error('Missing commercial-development-agent Vitest importer');
  }
  return match[1];
}

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
    expect([
      ...workspace.matchAll(/^strictDepBuilds:\s+true$/gmu),
    ]).toHaveLength(1);
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
    const lockedVitestVersion = parseAgentVitestVersion(lockfile);
    const lockedViteVersion = parseSnapshotDependency(
      lockfile,
      `vitest@${lockedVitestVersion}`,
      'vite',
    );

    expect(packageJson.devDependencies.vitest).toBe('^3.2.4');
    expect(lockedEsbuildVersions).toEqual(['0.28.1']);
    expect(lockfile).toMatch(AGENT_VITEST_IMPORTER_PATTERN);
    expect(lockfile).toMatch(VITEST_VITE_DEPENDENCY_PATTERN);
    expect(lockfile).toMatch(VITE_ESBUILD_DEPENDENCY_PATTERN);
    expect(lockedViteVersion).toMatch(/^7\.3\.6(?:\([^\n]*\))?$/u);
    expect(
      parseSnapshotDependency(lockfile, `vite@${lockedViteVersion}`, 'esbuild'),
    ).toBe('0.28.1');
    expect(lockfile).toContain(
      'esbuild@0.28.1:\n    resolution: {integrity: sha512-HrJrvZv5ayxBzPfwphOoNzkzOIIlifzk0KJrGK2c8R4+LKpMtpYLQeUdjnwjWv/LZlkH2laZk+4w78pi99D4Vw==}',
    );
  });

  it('does not borrow Vitest importer evidence from a different dependency section', () => {
    const hostileLockfile = [
      'importers:',
      '  packages/commercial-development-agent:',
      '    dependencies:',
      '      vitest:',
      '        specifier: ^3.2.4',
      '        version: 3.2.7',
      '',
    ].join('\n');

    expect(hostileLockfile).not.toMatch(AGENT_VITEST_IMPORTER_PATTERN);
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

  it('does not borrow Vite evidence from another Vitest peer resolution', () => {
    const hostileLockfile = [
      'importers:',
      '  packages/commercial-development-agent:',
      '    devDependencies:',
      '      vitest:',
      '        specifier: ^3.2.4',
      '        version: 3.2.7(@types/node@24.13.3)',
      '',
      'snapshots:',
      '  vitest@3.2.7(@types/node@99.0.0):',
      '    dependencies:',
      '      vite: 7.3.6(@types/node@99.0.0)',
      '',
    ].join('\n');
    const vitestVersion = parseAgentVitestVersion(hostileLockfile);

    expect(hostileLockfile).toMatch(VITEST_VITE_DEPENDENCY_PATTERN);
    expect(() =>
      parseSnapshotDependency(
        hostileLockfile,
        `vitest@${vitestVersion}`,
        'vite',
      ),
    ).toThrow(
      'Missing vite dependency for snapshot vitest@3.2.7(@types/node@24.13.3)',
    );
  });

  it('does not borrow esbuild evidence from another Vite peer resolution', () => {
    const hostileLockfile = [
      'snapshots:',
      '  vitest@3.2.7(@types/node@24.13.3):',
      '    dependencies:',
      '      vite: 7.3.6(@types/node@24.13.3)',
      '  vite@7.3.6(@types/node@99.0.0):',
      '    dependencies:',
      '      esbuild: 0.28.1',
      '',
    ].join('\n');
    const viteVersion = parseSnapshotDependency(
      hostileLockfile,
      'vitest@3.2.7(@types/node@24.13.3)',
      'vite',
    );

    expect(hostileLockfile).toMatch(VITE_ESBUILD_DEPENDENCY_PATTERN);
    expect(() =>
      parseSnapshotDependency(
        hostileLockfile,
        `vite@${viteVersion}`,
        'esbuild',
      ),
    ).toThrow(
      'Missing esbuild dependency for snapshot vite@7.3.6(@types/node@24.13.3)',
    );
  });
});
