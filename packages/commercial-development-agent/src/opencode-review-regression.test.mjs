import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  OpenCodeIdentityError,
  verifyReviewedOpenCodeCliIdentity,
} from './opencode-identity.mjs';
import { verifyOpenCodeInstallation } from './verify-opencode-identity.mjs';

const PACKAGE_ROOT = resolve(import.meta.dirname, '..');
const VERIFIER_PATH = resolve(
  import.meta.dirname,
  'verify-opencode-identity.mjs',
);
const WORKFLOW_PATH = resolve(
  import.meta.dirname,
  '../../../.github/workflows/opencode-commercial-development.yml',
);
const VITEST_CONFIG_PATH = resolve(import.meta.dirname, '../vitest.config.mjs');
const OPERATIONS_DOC_PATH = resolve(
  import.meta.dirname,
  '../../../docs/operations/opencode-commercial-development-loop.md',
);
const RESEARCH_DOC_PATH = resolve(
  import.meta.dirname,
  '../../../docs/research/2026-08-07-opencode-commercial-development-loop-standards.md',
);
const linuxX64Test =
  process.platform === 'linux' && process.arch === 'x64' ? it : it.skip;

/** Returns a deterministic fake OpenCode process for one reported version. */
function fakeOpenCodeSpawn(version) {
  return (_executable, argv) => {
    if (argv[0] === '--version') {
      return { status: 0, stdout: `${version}\n`, stderr: '' };
    }
    if (argv[0] === '--help') {
      return { status: 0, stdout: '', stderr: 'Options:\n  --pure\n' };
    }
    return { status: 0, stdout: '', stderr: 'run help\n' };
  };
}

/** Captures one injected text stream without exposing process-global output. */
function capturedStream() {
  let text = '';
  return {
    stream: {
      write(chunk) {
        text += String(chunk);
        return true;
      },
    },
    text: () => text,
  };
}

/** Returns one named workflow step without the following step. */
function namedStep(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\n      - name: ', start + marker.length);
  return source.slice(start, next === -1 ? source.length : next);
}

/** Runs the real verifier entrypoint with a bounded inherited environment. */
function runVerifier(extraEnv = {}) {
  return spawnSync(process.execPath, [VERIFIER_PATH], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      OPENCODE_PACKAGE_VERSION: '1.18.9',
      ...extraEnv,
    },
  });
}

/** Runs the exported verifier against one disposable package root. */
function runVerifierForPackageRoot(packageRoot) {
  const verifierUrl = pathToFileURL(VERIFIER_PATH).href;
  const source = [
    `import { verifyOpenCodeInstallation } from ${JSON.stringify(verifierUrl)};`,
    'process.exitCode = verifyOpenCodeInstallation({',
    '  packageRoot: process.env.TEST_PACKAGE_ROOT,',
    '});',
  ].join('\n');
  return spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', source],
    {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        OPENCODE_PACKAGE_VERSION: '1.18.9',
        TEST_PACKAGE_ROOT: packageRoot,
      },
    },
  );
}

describe('CodeRabbit OpenCode identity regressions', () => {
  it.each(['1.18.90', '1.18.9-beta', 'v1.18.9'])(
    'rejects non-exact reported version %s',
    (reportedVersion) => {
      expect(() =>
        verifyReviewedOpenCodeCliIdentity({
          executable: '/tmp/opencode',
          expectedVersion: '1.18.9',
          spawn: fakeOpenCodeSpawn(reportedVersion),
        }),
      ).toThrow(OpenCodeIdentityError);
    },
  );

  it('returns only bounded errors for manifest, pin, and identity failures', () => {
    const manifestOut = capturedStream();
    const manifestErr = capturedStream();
    expect(
      verifyOpenCodeInstallation({
        packageRoot: '/private/manifest-fixture',
        expectedVersion: '1.18.9',
        readPinnedVersion: () => {
          throw new Error('private manifest path');
        },
        stdout: manifestOut.stream,
        stderr: manifestErr.stream,
      }),
    ).toBe(1);
    expect(manifestOut.text()).toBe('');
    expect(manifestErr.text()).toBe(
      'Installed OpenCode version does not match the reviewed package pin.\n',
    );
    expect(manifestErr.text()).not.toContain('private manifest path');

    const pinOut = capturedStream();
    const pinErr = capturedStream();
    expect(
      verifyOpenCodeInstallation({
        packageRoot: '/private/pin-fixture',
        expectedVersion: '1.18.8',
        readPinnedVersion: () => '1.18.9',
        stdout: pinOut.stream,
        stderr: pinErr.stream,
      }),
    ).toBe(1);
    expect(pinOut.text()).toBe('');
    expect(pinErr.text()).toBe(
      'Workflow OpenCode pin does not match the reviewed package pin.\n',
    );

    const identityOut = capturedStream();
    const identityErr = capturedStream();
    expect(
      verifyOpenCodeInstallation({
        packageRoot: '/private/identity-fixture',
        expectedVersion: '1.18.9',
        readPinnedVersion: () => '1.18.9',
        resolveExecutable: () => '/tmp/opencode',
        verifyIdentity: () => {
          throw new Error('private executable path');
        },
        stdout: identityOut.stream,
        stderr: identityErr.stream,
      }),
    ).toBe(1);
    expect(identityOut.text()).toBe('');
    expect(identityErr.text()).toBe(
      'Installed OpenCode version does not match the reviewed package pin.\n',
    );
    expect(identityErr.text()).not.toContain('private executable path');
  });

  it('returns the exact reviewed identity on success', () => {
    const output = capturedStream();
    const error = capturedStream();
    expect(
      verifyOpenCodeInstallation({
        packageRoot: '/tmp/success-fixture',
        expectedVersion: '1.18.9',
        readPinnedVersion: () => '1.18.9',
        resolveExecutable: () => '/tmp/opencode',
        verifyIdentity: () => ({ version: '1.18.9' }),
        stdout: output.stream,
        stderr: error.stream,
      }),
    ).toBe(0);
    expect(output.text()).toBe('1.18.9\n');
    expect(error.text()).toBe('');
  });

  linuxX64Test('executes the installed verifier successfully', () => {
    const result = runVerifier();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('1.18.9\n');
    expect(result.stderr).toBe('');
  });

  it('exits cleanly when the workflow pin differs', () => {
    const result = runVerifier({ OPENCODE_PACKAGE_VERSION: '1.18.8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      'Workflow OpenCode pin does not match the reviewed package pin.\n',
    );
    expect(result.stderr).not.toContain(' at ');
  });

  it('exits cleanly for invalid manifests and missing reviewed binaries', () => {
    const root = mkdtempSync(join(tmpdir(), 'life-os-opencode-verifier-'));
    const invalidRoot = join(root, 'invalid');
    const missingBinaryRoot = join(root, 'missing-binary');
    mkdirSync(invalidRoot, { recursive: true });
    mkdirSync(join(missingBinaryRoot, 'node_modules/opencode-ai'), {
      recursive: true,
    });
    writeFileSync(join(invalidRoot, 'package.json'), '{');
    writeFileSync(
      join(missingBinaryRoot, 'package.json'),
      '{"devDependencies":{"opencode-ai":"1.18.9"}}\n',
    );
    try {
      for (const packageRoot of [invalidRoot, missingBinaryRoot]) {
        const result = runVerifierForPackageRoot(packageRoot);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe(
          'Installed OpenCode version does not match the reviewed package pin.\n',
        );
        expect(result.stderr).not.toContain(packageRoot);
        expect(result.stderr).not.toContain(' at ');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('forbids direct OpenCode identity commands with or without exec separators', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    const verification = namedStep(
      workflow,
      'Verify the exact OpenCode installation',
    );
    const forbidden =
      /\b(?:pnpm[^\n]*\bexec(?:\s+--)?\s+)?opencode\s+(?:--(?:version|help)|run\s+--help)\b/u;

    expect(verification).toContain(
      'node packages/commercial-development-agent/src/verify-opencode-identity.mjs',
    );
    expect(verification).not.toMatch(forbidden);
    expect('pnpm exec opencode --version').toMatch(forbidden);
    expect('pnpm exec -- opencode --help').toMatch(forbidden);
    expect('pnpm exec -- opencode run --help').toMatch(forbidden);
  });

  it('keeps the verifier entrypoint covered and documents combined help streams', () => {
    const vitestConfig = readFileSync(VITEST_CONFIG_PATH, 'utf8');
    const operations = readFileSync(OPERATIONS_DOC_PATH, 'utf8');
    const research = readFileSync(RESEARCH_DOC_PATH, 'utf8');

    expect(vitestConfig).not.toContain('src/verify-opencode-identity.mjs');
    expect(operations).toContain(
      'reads `--pure` from the combined stdout and stderr of `opencode --help`',
    );
    expect(research).toContain(
      'detecting `--pure` in the combined stdout and stderr of `--help`',
    );
  });
});
