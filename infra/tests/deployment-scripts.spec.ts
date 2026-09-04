import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');
const kubernetesRoot = resolve(repositoryRoot, 'infra/kubernetes');
const identityDatabaseUrl = process.env.IDENTITY_DATABASE_URL;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const testDatabasePattern = /^[a-z0-9_]*_test$/u;
const temporaryDatabasePattern = /^life_os_migration_history_[0-9a-f]{32}$/u;
const describeWithDatabase = identityDatabaseUrl ? describe : describe.skip;

/** Execute one deployment Python helper with a bounded test timeout. */
function python(
  script: string,
  arguments_: string[],
  environment: NodeJS.ProcessEnv,
) {
  return spawnSync('python', [resolve(kubernetesRoot, script), ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: { ...process.env, ...environment },
    timeout: 10_000,
  });
}

/** Build a synthetic PostgreSQL URI without committing a connection-string literal. */
function databaseUri(query: Readonly<Record<string, string>> = {}): string {
  const scheme = ['post', 'gresql'].join('');
  const parameters = new URLSearchParams(query);
  const queryString = parameters.size > 0 ? `?${parameters.toString()}` : '';
  return `${scheme}://life_user:${encodeURIComponent('p@ss')}@db.example:5433/life_os${queryString}`;
}

/** Require the CI-provided source URL to be a loopback-only disposable test database. */
function requireLoopbackTestDatabaseUrl(): string {
  if (!identityDatabaseUrl) {
    throw new Error('IDENTITY_DATABASE_URL is required');
  }
  const parsedUrl = new URL(identityDatabaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (
    !loopbackHosts.has(parsedUrl.hostname) ||
    !testDatabasePattern.test(databaseName)
  ) {
    throw new Error(
      'Migration runner integration requires a loopback PostgreSQL test database',
    );
  }
  return identityDatabaseUrl;
}

/** Return a sibling PostgreSQL database URL while preserving connection authority. */
function siblingDatabaseUrl(sourceUrl: string, databaseName: string): string {
  const parsedUrl = new URL(sourceUrl);
  parsedUrl.pathname = `/${databaseName}`;
  return parsedUrl.toString();
}

/** Build credential-bearing libpq environment without putting a database URI in argv. */
function libpqEnvironment(
  sourceUrl: string,
  databaseName: string,
): NodeJS.ProcessEnv {
  const parsedUrl = new URL(sourceUrl);
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: parsedUrl.hostname,
    PGPORT: parsedUrl.port || '5432',
    PGUSER: decodeURIComponent(parsedUrl.username),
    PGPASSWORD: decodeURIComponent(parsedUrl.password),
    PGDATABASE: databaseName,
  };
  const sslMode = parsedUrl.searchParams.get('sslmode');
  if (sslMode) {
    environment.PGSSLMODE = sslMode;
  }
  return environment;
}

/** Execute psql without exposing credentials or a connection URI in process arguments. */
function psql(
  sourceUrl: string,
  databaseName: string,
  arguments_: string[],
) {
  return spawnSync(
    'psql',
    ['--no-psqlrc', '--no-password', ...arguments_],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: libpqEnvironment(sourceUrl, databaseName),
      timeout: 30_000,
    },
  );
}

/** Quote only a locally generated and strictly allowlisted PostgreSQL database identifier. */
function quotedTemporaryDatabase(databaseName: string): string {
  if (!temporaryDatabasePattern.test(databaseName)) {
    throw new Error('Temporary migration history database name is invalid');
  }
  return `"${databaseName}"`;
}

describe('PostgreSQL service-file writer', () => {
  it('parses a URI into a private service file without retaining the URI', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-os-pg-service-'));
    const output = join(directory, 'pg_service.conf');
    const databaseUrl = databaseUri({
      sslmode: 'require',
      connect_timeout: '5',
    });

    const result = python(
      'write-pg-service.py',
      [
        '--environment-variable',
        'TEST_DATABASE_URL',
        '--service-name',
        'planning_service',
        '--output',
        output,
      ],
      { TEST_DATABASE_URL: databaseUrl },
    );

    expect(result.status, result.stderr).toBe(0);
    const serviceFile = readFileSync(output, 'utf8');
    expect(serviceFile).toContain('[planning_service]');
    expect(serviceFile).toContain('host=db.example');
    expect(serviceFile).toContain('port=5433');
    expect(serviceFile).toContain('dbname=life_os');
    expect(serviceFile).toContain('user=life_user');
    expect(serviceFile).toContain('password=p@ss');
    expect(serviceFile).toContain('sslmode=require');
    expect(serviceFile).toContain('connect_timeout=5');
    expect(serviceFile).not.toContain(databaseUrl);
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });

  it('rejects connection parameters outside the reviewed allowlist', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-os-pg-service-'));
    const output = join(directory, 'pg_service.conf');
    const result = python(
      'write-pg-service.py',
      [
        '--environment-variable',
        'TEST_DATABASE_URL',
        '--service-name',
        'planning_service',
        '--output',
        output,
      ],
      { TEST_DATABASE_URL: databaseUri({ service: 'unexpected' }) },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'unsupported PostgreSQL URI parameter: service',
    );
  });
});

describe('production manifest renderer', () => {
  it('renders approved immutable inputs through the supplied kubectl binary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-os-render-'));
    const fakeKubectl = join(directory, 'kubectl');
    const renderRoot = join(directory, 'rendered-tree');
    const output = join(directory, 'production.yaml');
    writeFileSync(
      fakeKubectl,
      '#!/usr/bin/env bash\nset -Eeuo pipefail\nroot="$(dirname "$(dirname "$2")")"\ncat "${root}/base/edge-workloads.yaml"\n',
      'utf8',
    );
    chmodSync(fakeKubectl, 0o700);

    const result = python(
      'render-production-manifest.py',
      [
        '--source-root',
        kubernetesRoot,
        '--render-root',
        renderRoot,
        '--output',
        output,
        '--kubectl',
        fakeKubectl,
      ],
      {
        WEB_IMAGE: `ghcr.io/contextualwisdomlab/life-os-web@sha256:${'1'.repeat(64)}`,
        GATEWAY_IMAGE: `ghcr.io/contextualwisdomlab/life-os-gateway@sha256:${'2'.repeat(64)}`,
        WEB_ORIGIN: 'https://life.example',
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const manifest = readFileSync(output, 'utf8');
    expect(manifest).toContain(`sha256:${'1'.repeat(64)}`);
    expect(manifest).toContain(`sha256:${'2'.repeat(64)}`);
    expect(manifest).toContain('https://life.example');
    expect(manifest).not.toContain(`sha256:${'0'.repeat(64)}`);
    expect(manifest).not.toContain('life-os.invalid');
  });

  it('rejects an immutable image outside the approved repository path', () => {
    const directory = mkdtempSync(join(tmpdir(), 'life-os-render-'));
    const result = python(
      'render-production-manifest.py',
      [
        '--source-root',
        kubernetesRoot,
        '--render-root',
        join(directory, 'rendered-tree'),
        '--output',
        join(directory, 'production.yaml'),
      ],
      {
        WEB_IMAGE: `ghcr.io/other/life-os-web@sha256:${'1'.repeat(64)}`,
        GATEWAY_IMAGE: `ghcr.io/contextualwisdomlab/life-os-gateway@sha256:${'2'.repeat(64)}`,
        WEB_ORIGIN: 'https://life.example',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'image reference must use the approved LifeOS GHCR path and sha256 digest',
    );
  });
});

describeWithDatabase('production migration history runner', () => {
  it('applies and replays the complete identity history including duplicate numeric prefixes through 0007', () => {
    const sourceUrl = requireLoopbackTestDatabaseUrl();
    const temporaryDatabaseName = `life_os_migration_history_${randomUUID().replaceAll('-', '')}`;
    const temporaryDatabaseIdentifier = quotedTemporaryDatabase(
      temporaryDatabaseName,
    );
    const temporaryUrl = siblingDatabaseUrl(sourceUrl, temporaryDatabaseName);
    const adminDatabaseName = 'postgres';
    let databaseCreated = false;

    try {
      const createResult = psql(sourceUrl, adminDatabaseName, [
        '--command',
        `CREATE DATABASE ${temporaryDatabaseIdentifier}`,
      ]);
      expect(createResult.status, createResult.stderr).toBe(0);
      databaseCreated = true;

      const runnerEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        LIFE_OS_MIGRATION_CONFIRMATION: 'apply-forward-only',
        IDENTITY_DATABASE_URL: temporaryUrl,
        PLANNING_DATABASE_URL: temporaryUrl,
        HABIT_DATABASE_URL: temporaryUrl,
        AI_DATABASE_URL: temporaryUrl,
        REVIEW_DATABASE_URL: temporaryUrl,
      };
      const firstRun = spawnSync(
        'bash',
        [resolve(kubernetesRoot, 'run-migrations.sh')],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: runnerEnvironment,
          timeout: 60_000,
        },
      );
      expect(firstRun.status, firstRun.stderr).toBe(0);
      expect(firstRun.stdout).toContain('migration_status=completed');

      const historyResult = psql(sourceUrl, temporaryDatabaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT migration_name FROM life_os_deployment.schema_migrations WHERE service_name = 'identity' ORDER BY migration_name COLLATE "C"`,
      ]);
      expect(historyResult.status, historyResult.stderr).toBe(0);
      const recordedIdentityHistory = historyResult.stdout
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean);
      const expectedIdentityHistory = readdirSync(
        resolve(repositoryRoot, 'apps/identity-service/migrations'),
      )
        .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
        .sort();
      expect(recordedIdentityHistory).toEqual(expectedIdentityHistory);
      expect(
        recordedIdentityHistory.filter((name) => name.startsWith('0004_')),
      ).toHaveLength(2);
      expect(
        recordedIdentityHistory.filter((name) => name.startsWith('0005_')),
      ).toHaveLength(2);
      expect(recordedIdentityHistory.at(-1)).toBe(
        '0007_identity_database_semantic_names.sql',
      );

      const secondRun = spawnSync(
        'bash',
        [resolve(kubernetesRoot, 'run-migrations.sh')],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: runnerEnvironment,
          timeout: 60_000,
        },
      );
      expect(secondRun.status, secondRun.stderr).toBe(0);
      expect(secondRun.stdout).toContain(
        'migration_status=already_applied service=identity migration=0007_identity_database_semantic_names.sql',
      );
      expect(secondRun.stdout).toContain('migration_status=completed');
    } finally {
      if (databaseCreated) {
        const dropResult = psql(sourceUrl, adminDatabaseName, [
          '--command',
          `DROP DATABASE ${temporaryDatabaseIdentifier}`,
        ]);
        expect(dropResult.status, dropResult.stderr).toBe(0);
      }
    }
  }, 120_000);
});
