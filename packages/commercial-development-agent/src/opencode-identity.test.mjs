import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  MINIMUM_REVIEWED_OPENCODE_BINARY_BYTES,
  OpenCodeIdentityError,
  createIsolatedOpenCodeEnvironment,
  readOpenCodeVersionLine,
  readPinnedOpenCodePackageVersion,
  resolveReviewedOpenCodeExecutable,
  verifyReviewedOpenCodeCliIdentity,
} from './opencode-identity.mjs';

const PACKAGE_PATH = resolve(import.meta.dirname, '../package.json');
const linuxX64Test =
  process.platform === 'linux' && process.arch === 'x64' ? it : it.skip;

/** Creates one fake OpenCode package layout under a temporary directory. */
function fakePackage(files) {
  const root = mkdtempSync(join(tmpdir(), 'life-os-opencode-identity-'));
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    if (contents !== null) {
      writeFileSync(path, contents);
    }
  }
  return root;
}

describe('reviewed OpenCode CLI identity', () => {
  it('reads the exact commercial-agent package pin', () => {
    expect(readPinnedOpenCodePackageVersion(PACKAGE_PATH)).toBe('1.18.9');
  });

  it('rejects a missing or floating OpenCode package pin', () => {
    const root = fakePackage({
      'missing.json': '{',
      'empty.json': '{}',
      'floating.json': '{"devDependencies":{"opencode-ai":"^1.18.9"}}',
    });
    try {
      expect(() =>
        readPinnedOpenCodePackageVersion(join(root, 'missing.json')),
      ).toThrow(OpenCodeIdentityError);
      expect(() =>
        readPinnedOpenCodePackageVersion(join(root, 'empty.json')),
      ).toThrow(OpenCodeIdentityError);
      expect(() =>
        readPinnedOpenCodePackageVersion(join(root, 'floating.json')),
      ).toThrow(OpenCodeIdentityError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads the first identity line and ignores later banner text', () => {
    expect(readOpenCodeVersionLine(undefined)).toBe('');
    expect(readOpenCodeVersionLine('1.18.9\r\nbanner')).toBe('1.18.9');
  });

  it('omits NODE_OPTIONS and fills missing PATH or HOME', () => {
    expect(
      createIsolatedOpenCodeEnvironment({
        PATH: '/usr/bin',
        HOME: '/tmp/home',
        NODE_OPTIONS: '--no-warnings',
      }),
    ).toEqual({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCODE_DISABLE_MODELS_FETCH: 'true',
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    });
    expect(createIsolatedOpenCodeEnvironment({})).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/tmp',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCODE_DISABLE_MODELS_FETCH: 'true',
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    });
  });

  it('prefers the postinstall-copied binary over the platform package', () => {
    const root = fakePackage({
      'opencode-ai/bin/opencode.exe': Buffer.alloc(
        MINIMUM_REVIEWED_OPENCODE_BINARY_BYTES,
        1,
      ),
      'opencode-linux-x64/bin/opencode': Buffer.alloc(
        MINIMUM_REVIEWED_OPENCODE_BINARY_BYTES,
        2,
      ),
    });
    try {
      expect(resolveReviewedOpenCodeExecutable(join(root, 'opencode-ai'))).toBe(
        realpathSync(join(root, 'opencode-ai/bin/opencode.exe')),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips the postinstall stub and missing or unreadable candidates', () => {
    const root = fakePackage({
      'opencode-ai/bin/opencode.exe': 'stub',
      'opencode-linux-x64/bin/opencode': Buffer.alloc(
        MINIMUM_REVIEWED_OPENCODE_BINARY_BYTES,
        3,
      ),
    });
    const missingExe = fakePackage({
      'opencode-ai/package.json': '{}',
      'opencode-linux-x64/bin/opencode': Buffer.alloc(
        MINIMUM_REVIEWED_OPENCODE_BINARY_BYTES,
        4,
      ),
    });
    const missingRoot = fakePackage({});
    try {
      expect(resolveReviewedOpenCodeExecutable(join(root, 'opencode-ai'))).toBe(
        realpathSync(join(root, 'opencode-linux-x64/bin/opencode')),
      );
      expect(
        resolveReviewedOpenCodeExecutable(join(missingExe, 'opencode-ai')),
      ).toBe(realpathSync(join(missingExe, 'opencode-linux-x64/bin/opencode')));
      expect(() =>
        resolveReviewedOpenCodeExecutable(join(missingRoot, 'missing')),
      ).toThrow(OpenCodeIdentityError);
      expect(() =>
        resolveReviewedOpenCodeExecutable(join(root, 'opencode-ai'), {
          existsSync: () => true,
          realpathSync: (path) => path,
          statSync: () => {
            throw new Error('stat failed');
          },
        }),
      ).toThrow(OpenCodeIdentityError);
      expect(() =>
        resolveReviewedOpenCodeExecutable(join(root, 'opencode-ai'), {
          existsSync: () => true,
          realpathSync: (path) => path,
          statSync: () => ({ isFile: () => false, size: 4_096 }),
        }),
      ).toThrow(OpenCodeIdentityError);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(missingExe, { recursive: true, force: true });
      rmSync(missingRoot, { recursive: true, force: true });
    }
  });

  it('accepts only the reviewed CLI identity and --pure help contract', () => {
    const calls = [];
    const spawn = (executable, argv) => {
      calls.push(argv);
      if (argv[0] === '--version') {
        return { status: 0, stdout: '1.18.9\n', stderr: '' };
      }
      if (argv[0] === '--help') {
        return {
          status: 0,
          stdout: undefined,
          stderr: 'Options:\n      --pure\n',
        };
      }
      return { status: 0, stdout: '', stderr: 'run help' };
    };

    expect(
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '1.18.9',
        spawn,
      }),
    ).toEqual({
      executable: '/tmp/opencode',
      version: '1.18.9',
    });
    expect(calls).toEqual([['--version'], ['--help'], ['run', '--help']]);
    expect(
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '1.18.9',
        spawn: (_executable, argv) => {
          if (argv[0] === '--version') {
            return { status: 0, stdout: '1.18.9', stderr: '' };
          }
          if (argv[0] === '--help') {
            return { status: 0, stdout: '--pure\n' };
          }
          return { status: 0, stdout: '', stderr: 'run help' };
        },
      }),
    ).toEqual({
      executable: '/tmp/opencode',
      version: '1.18.9',
    });

    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: undefined,
        expectedVersion: '1.18.9',
        spawn,
      }),
    ).toThrow(OpenCodeIdentityError);
    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: '',
        expectedVersion: '1.18.9',
        spawn,
      }),
    ).toThrow(OpenCodeIdentityError);
    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '^1.18.9',
        spawn,
      }),
    ).toThrow(OpenCodeIdentityError);
    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '1.18.9',
        spawn: () => {
          throw new Error('spawn failed');
        },
      }),
    ).toThrow(OpenCodeIdentityError);
    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '1.18.9',
        spawn: () => ({ status: 1, stdout: '1.18.9', stderr: '' }),
      }),
    ).toThrow(OpenCodeIdentityError);
    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '1.18.9',
        spawn: () => ({ status: 0, stdout: '1.2.3', stderr: '' }),
      }),
    ).toThrow(OpenCodeIdentityError);
    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '1.18.9',
        spawn: (_executable, argv) =>
          argv[0] === '--version'
            ? { status: 0, stdout: '1.18.9', stderr: '' }
            : { status: 1, stdout: '', stderr: '--pure' },
      }),
    ).toThrow(OpenCodeIdentityError);
    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '1.18.9',
        spawn: (_executable, argv) =>
          argv[0] === '--version'
            ? { status: 0, stdout: '1.18.9', stderr: '' }
            : { status: 0, stdout: 'help', stderr: '' },
      }),
    ).toThrow(OpenCodeIdentityError);
    expect(() =>
      verifyReviewedOpenCodeCliIdentity({
        executable: '/tmp/opencode',
        expectedVersion: '1.18.9',
        spawn: (_executable, argv) => {
          if (argv[0] === '--version') {
            return { status: 0, stdout: '1.18.9', stderr: '' };
          }
          if (argv[0] === '--help') {
            return { status: 0, stdout: '--pure', stderr: '' };
          }
          return { status: 1, stdout: '', stderr: '' };
        },
      }),
    ).toThrow(OpenCodeIdentityError);
  });

  linuxX64Test(
    'proves the installed linux-x64 CLI reports 1.18.9 and --pure',
    () => {
      const opencodePackage = resolve(
        import.meta.dirname,
        '../node_modules/opencode-ai',
      );
      let executable;
      try {
        executable = resolveReviewedOpenCodeExecutable(opencodePackage);
      } catch {
        executable = resolve(
          dirname(opencodePackage),
          'opencode-linux-x64/bin/opencode',
        );
      }
      const identity = verifyReviewedOpenCodeCliIdentity({
        executable,
        expectedVersion: '1.18.9',
        spawn: spawnSync,
        env: createIsolatedOpenCodeEnvironment({
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          NODE_OPTIONS: '--no-warnings',
        }),
      });
      expect(identity.version).toBe('1.18.9');
    },
  );
});
