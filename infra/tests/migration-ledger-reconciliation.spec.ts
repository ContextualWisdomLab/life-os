import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(process.cwd(), '../..');
const kubernetesRoot = resolve(repositoryRoot, 'infra/kubernetes');
const identityDatabaseUrl = process.env.IDENTITY_DATABASE_URL;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const testDatabasePattern = /^[a-z0-9_]*_test$/u;
const temporaryDatabasePattern = /^life_os_legacy_migrations_[0-9a-f]{32}$/u;
const describeWithDatabase = identityDatabaseUrl ? describe : describe.skip;

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
      'Migration reconciliation requires a loopback PostgreSQL test database',
    );
  }
  return identityDatabaseUrl;
}

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
  if (sslMode) environment.PGSSLMODE = sslMode;
  return environment;
}

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

function siblingDatabaseUrl(sourceUrl: string, databaseName: string): string {
  const parsedUrl = new URL(sourceUrl);
  parsedUrl.pathname = `/${databaseName}`;
  return parsedUrl.toString();
}

function quotedDatabase(databaseName: string): string {
  if (!temporaryDatabasePattern.test(databaseName)) {
    throw new Error('Temporary migration database name is invalid');
  }
  return `"${databaseName}"`;
}

function migrationDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function identityMigrationsThroughSequence(maximumSequence: number): string[] {
  return readdirSync(resolve(repositoryRoot, 'apps/identity-service/migrations'))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .filter((name) => Number(name.slice(0, 4)) <= maximumSequence)
    .sort();
}

describeWithDatabase('legacy migration-ledger reconciliation', () => {
  it('upgrades an existing sequence-keyed Identity ledger through the semantic rename without rerunning historical DDL', () => {
    const sourceUrl = requireLoopbackTestDatabaseUrl();
    const temporaryDatabaseName = `life_os_legacy_migrations_${randomUUID().replaceAll('-', '')}`;
    const databaseIdentifier = quotedDatabase(temporaryDatabaseName);
    const temporaryUrl = siblingDatabaseUrl(sourceUrl, temporaryDatabaseName);
    const adminDatabaseName = 'postgres';
    let databaseCreated = false;

    try {
      const createResult = psql(sourceUrl, adminDatabaseName, [
        '--command',
        `CREATE DATABASE ${databaseIdentifier}`,
      ]);
      expect(createResult.status, createResult.stderr).toBe(0);
      databaseCreated = true;

      const historicalFiles = identityMigrationsThroughSequence(6);
      for (const migrationName of historicalFiles) {
        const migrationPath = resolve(
          repositoryRoot,
          'apps/identity-service/migrations',
          migrationName,
        );
        const applyResult = psql(sourceUrl, temporaryDatabaseName, [
          '--set=ON_ERROR_STOP=1',
          '--file',
          migrationPath,
        ]);
        expect(applyResult.status, `${migrationName}\n${applyResult.stderr}`).toBe(
          0,
        );
      }

      const firstBySequence = new Map<number, string>();
      for (const migrationName of historicalFiles) {
        const sequence = Number(migrationName.slice(0, 4));
        if (!firstBySequence.has(sequence)) {
          firstBySequence.set(sequence, migrationName);
        }
      }
      const ledgerRows = [...firstBySequence.entries()]
        .map(([sequence, migrationName]) => {
          const digest = migrationDigest(
            resolve(
              repositoryRoot,
              'apps/identity-service/migrations',
              migrationName,
            ),
          );
          return `('identity', '${migrationName}', ${sequence}, '${digest}', 'applied', clock_timestamp())`;
        })
        .join(',\n');
      const ledgerResult = psql(sourceUrl, temporaryDatabaseName, [
        '--set=ON_ERROR_STOP=1',
        '--command',
        `CREATE SCHEMA life_os_deployment;
         CREATE TABLE life_os_deployment.schema_migrations (
           service_name text NOT NULL,
           migration_name text NOT NULL,
           migration_sequence integer NOT NULL,
           migration_sha256 character(64) NOT NULL,
           migration_status text NOT NULL,
           applied_at timestamptz,
           PRIMARY KEY (service_name, migration_name)
         );
         CREATE UNIQUE INDEX schema_migrations_service_sequence_unique
           ON life_os_deployment.schema_migrations (service_name, migration_sequence);
         INSERT INTO life_os_deployment.schema_migrations
           (service_name, migration_name, migration_sequence, migration_sha256, migration_status, applied_at)
         VALUES ${ledgerRows};`,
      ]);
      expect(ledgerResult.status, ledgerResult.stderr).toBe(0);

      expect(firstBySequence.get(4)).toBe('0004_oauth_secret_key_versions.sql');
      expect(firstBySequence.get(5)).toBe(
        '0005_finalize_session_authentication_age.sql',
      );

      const runnerEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        LIFE_OS_MIGRATION_CONFIRMATION: 'apply-forward-only',
        IDENTITY_DATABASE_URL: temporaryUrl,
        PLANNING_DATABASE_URL: temporaryUrl,
        HABIT_DATABASE_URL: temporaryUrl,
        AI_DATABASE_URL: temporaryUrl,
        REVIEW_DATABASE_URL: temporaryUrl,
      };
      const runResult = spawnSync(
        'bash',
        [resolve(kubernetesRoot, 'run-migrations.sh')],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: runnerEnvironment,
          timeout: 60_000,
        },
      );
      expect(runResult.status, runResult.stderr).toBe(0);
      expect(runResult.stdout).toContain(
        'migration_status=reconciled service=identity migration=0004_session_authentication_age.sql',
      );
      expect(runResult.stdout).toContain(
        'migration_status=reconciled service=identity migration=0005_opaque_uuid_v4_identifiers.sql',
      );
      expect(runResult.stdout).toContain(
        'migration_status=applied service=identity migration=0007_identity_database_semantic_names.sql',
      );

      const historyResult = psql(sourceUrl, temporaryDatabaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT migration_name
         FROM life_os_deployment.schema_migrations
         WHERE service_name = 'identity'
         ORDER BY migration_name COLLATE "C"`,
      ]);
      expect(historyResult.status, historyResult.stderr).toBe(0);
      const recordedHistory = historyResult.stdout
        .trim()
        .split(/\r?\n/u)
        .filter(Boolean);
      const expectedHistory = readdirSync(
        resolve(repositoryRoot, 'apps/identity-service/migrations'),
      )
        .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
        .sort();
      expect(recordedHistory).toEqual(expectedHistory);
    } finally {
      if (databaseCreated) {
        const dropResult = psql(sourceUrl, adminDatabaseName, [
          '--command',
          `DROP DATABASE ${databaseIdentifier}`,
        ]);
        expect(dropResult.status, dropResult.stderr).toBe(0);
      }
    }
  }, 120_000);
});
