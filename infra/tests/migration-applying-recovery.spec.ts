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
const temporaryDatabasePattern = /^life_os_retry_migrations_[0-9a-f]{32}$/u;
const describeWithDatabase = identityDatabaseUrl ? describe : describe.skip;

/** Requires an explicitly disposable loopback PostgreSQL database from CI. */
function requireLoopbackTestDatabaseUrl(): string {
  if (!identityDatabaseUrl) throw new Error('IDENTITY_DATABASE_URL is required');
  const parsedUrl = new URL(identityDatabaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (
    !loopbackHosts.has(parsedUrl.hostname) ||
    !testDatabasePattern.test(databaseName)
  ) {
    throw new Error('Migration recovery requires a loopback PostgreSQL test database');
  }
  return identityDatabaseUrl;
}

/** Builds libpq process state without exposing credentials in argv. */
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

/** Executes psql with bounded runtime and no URI in process arguments. */
function psql(
  sourceUrl: string,
  databaseName: string,
  arguments_: string[],
) {
  return spawnSync('psql', ['--no-psqlrc', '--no-password', ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: libpqEnvironment(sourceUrl, databaseName),
    timeout: 30_000,
  });
}

/** Returns a sibling database URL using the same loopback connection authority. */
function siblingDatabaseUrl(sourceUrl: string, databaseName: string): string {
  const parsedUrl = new URL(sourceUrl);
  parsedUrl.pathname = `/${databaseName}`;
  return parsedUrl.toString();
}

/** Quotes only this test's locally generated database identifier. */
function quotedDatabase(databaseName: string): string {
  if (!temporaryDatabasePattern.test(databaseName)) {
    throw new Error('Temporary migration recovery database name is invalid');
  }
  return `"${databaseName}"`;
}

/** Computes the immutable digest recorded by the production migration runner. */
function migrationDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Lists canonical Identity migrations in the same C-compatible filename order. */
function identityMigrations(): string[] {
  return readdirSync(resolve(repositoryRoot, 'apps/identity-service/migrations'))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
}

describeWithDatabase('transactional migration retry recovery', () => {
  it('recovers a rolled-back 0007 applying marker and completes the exact migration', () => {
    const sourceUrl = requireLoopbackTestDatabaseUrl();
    const temporaryDatabaseName = `life_os_retry_migrations_${randomUUID().replaceAll('-', '')}`;
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

      const migrationNames = identityMigrations();
      const renameMigrationName = '0007_identity_database_semantic_names.sql';
      const historicalNames = migrationNames.filter(
        (name) => name !== renameMigrationName,
      );
      for (const migrationName of historicalNames) {
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
        expect(applyResult.status, `${migrationName}\n${applyResult.stderr}`).toBe(0);
      }

      const appliedRows = historicalNames
        .map((migrationName) => {
          const migrationPath = resolve(
            repositoryRoot,
            'apps/identity-service/migrations',
            migrationName,
          );
          const sequence = Number(migrationName.slice(0, 4));
          return `('identity', '${migrationName}', ${sequence}, '${migrationDigest(migrationPath)}', 'applied', clock_timestamp(), false)`;
        })
        .join(',\n');
      const renamePath = resolve(
        repositoryRoot,
        'apps/identity-service/migrations',
        renameMigrationName,
      );
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
           migration_reconciled boolean NOT NULL DEFAULT false,
           PRIMARY KEY (service_name, migration_name)
         );
         INSERT INTO life_os_deployment.schema_migrations
           (service_name, migration_name, migration_sequence, migration_sha256, migration_status, applied_at, migration_reconciled)
         VALUES ${appliedRows};
         INSERT INTO life_os_deployment.schema_migrations
           (service_name, migration_name, migration_sequence, migration_sha256, migration_status, applied_at, migration_reconciled)
         VALUES ('identity', '${renameMigrationName}', 7, '${migrationDigest(renamePath)}', 'applying', NULL, false);`,
      ]);
      expect(ledgerResult.status, ledgerResult.stderr).toBe(0);

      const precondition = psql(sourceUrl, temporaryDatabaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT to_regclass('identity.users') IS NOT NULL
           AND to_regclass('identity.user_accounts') IS NULL`,
      ]);
      expect(precondition.status, precondition.stderr).toBe(0);
      expect(precondition.stdout.trim()).toBe('t');

      const runnerEnvironment: NodeJS.ProcessEnv = {
        ...process.env,
        LIFE_OS_MIGRATION_CONFIRMATION: 'apply-forward-only',
        PGOPTIONS:
          '-c life_os.identity_schema_rename_confirmation=identity-service-drained',
        IDENTITY_DATABASE_URL: temporaryUrl,
        PLANNING_DATABASE_URL: temporaryUrl,
        HABIT_DATABASE_URL: temporaryUrl,
        AI_DATABASE_URL: temporaryUrl,
        REVIEW_DATABASE_URL: temporaryUrl,
      };
      const retryResult = spawnSync(
        'bash',
        [resolve(kubernetesRoot, 'run-migrations.sh')],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: runnerEnvironment,
          timeout: 60_000,
        },
      );
      expect(retryResult.status, retryResult.stderr).toBe(0);
      expect(retryResult.stdout).toContain(
        `migration_status=retrying service=identity migration=${renameMigrationName}`,
      );
      expect(retryResult.stdout).toContain(
        `migration_status=applied service=identity migration=${renameMigrationName}`,
      );

      const finalState = psql(sourceUrl, temporaryDatabaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT migration_status || ':' ||
                (to_regclass('identity.user_accounts') IS NOT NULL)::text || ':' ||
                (to_regclass('identity.users') IS NULL)::text
         FROM life_os_deployment.schema_migrations
         WHERE service_name = 'identity'
           AND migration_name = '${renameMigrationName}'`,
      ]);
      expect(finalState.status, finalState.stderr).toBe(0);
      expect(finalState.stdout.trim()).toBe('applied:true:true');
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
