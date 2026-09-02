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
const temporaryDatabasePattern = /^life_os_semantic_rename_[0-9a-f]{32}$/u;
const describeWithDatabase = identityDatabaseUrl ? describe : describe.skip;
const renameMigrationName = '0007_identity_database_semantic_names.sql';

/** Require a disposable loopback PostgreSQL database supplied by CI. */
function requireLoopbackTestDatabaseUrl(): string {
  if (!identityDatabaseUrl) throw new Error('IDENTITY_DATABASE_URL is required');
  const parsedUrl = new URL(identityDatabaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (!loopbackHosts.has(parsedUrl.hostname) || !testDatabasePattern.test(databaseName)) {
    throw new Error('Identity semantic rename tests require a loopback PostgreSQL test database');
  }
  return identityDatabaseUrl;
}

/** Return a sibling database URL while preserving the CI connection authority. */
function siblingDatabaseUrl(sourceUrl: string, databaseName: string): string {
  const parsedUrl = new URL(sourceUrl);
  parsedUrl.pathname = `/${databaseName}`;
  return parsedUrl.toString();
}

/** Build libpq process state without exposing credentials in process arguments. */
function libpqEnvironment(
  sourceUrl: string,
  databaseName: string,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const parsedUrl = new URL(sourceUrl);
  return {
    ...process.env,
    PGHOST: parsedUrl.hostname,
    PGPORT: parsedUrl.port || '5432',
    PGUSER: decodeURIComponent(parsedUrl.username),
    PGPASSWORD: decodeURIComponent(parsedUrl.password),
    PGDATABASE: databaseName,
    ...overrides,
  };
}

/** Execute psql with bounded runtime and no credential-bearing URI argument. */
function psql(
  sourceUrl: string,
  databaseName: string,
  arguments_: string[],
  overrides: NodeJS.ProcessEnv = {},
) {
  return spawnSync('psql', ['--no-psqlrc', '--no-password', ...arguments_], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: libpqEnvironment(sourceUrl, databaseName, overrides),
    timeout: 30_000,
  });
}

/** Quote only a locally generated temporary database identifier. */
function quotedDatabase(databaseName: string): string {
  if (!temporaryDatabasePattern.test(databaseName)) {
    throw new Error('Temporary semantic rename database name is invalid');
  }
  return `"${databaseName}"`;
}

/** Return the immutable digest recorded by the migration runner. */
function migrationDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** List Identity migrations in the same C-compatible filename order as production. */
function identityMigrations(): string[] {
  return readdirSync(resolve(repositoryRoot, 'apps/identity-service/migrations'))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
}

/** Run the production migration entrypoint against one disposable database. */
function runMigrations(databaseUrl: string) {
  return spawnSync('bash', [resolve(kubernetesRoot, 'run-migrations.sh')], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      LIFE_OS_MIGRATION_CONFIRMATION: 'apply-forward-only',
      LIFE_OS_IDENTITY_SCHEMA_RENAME_CONFIRMATION: 'identity-service-drained',
      IDENTITY_DATABASE_URL: databaseUrl,
      PLANNING_DATABASE_URL: databaseUrl,
      HABIT_DATABASE_URL: databaseUrl,
      AI_DATABASE_URL: databaseUrl,
      REVIEW_DATABASE_URL: databaseUrl,
    },
    timeout: 60_000,
  });
}

describeWithDatabase('Identity semantic rename deployment recovery', () => {
  it('uses explicit drain authority even when the database URI contains conflicting startup options', () => {
    const sourceUrl = requireLoopbackTestDatabaseUrl();
    const databaseName = `life_os_semantic_rename_${randomUUID().replaceAll('-', '')}`;
    const databaseIdentifier = quotedDatabase(databaseName);
    const adminDatabaseName = 'postgres';
    let databaseCreated = false;

    try {
      const createResult = psql(sourceUrl, adminDatabaseName, [
        '--command',
        `CREATE DATABASE ${databaseIdentifier}`,
      ]);
      expect(createResult.status, createResult.stderr).toBe(0);
      databaseCreated = true;

      const databaseUrl = new URL(siblingDatabaseUrl(sourceUrl, databaseName));
      databaseUrl.searchParams.set(
        'options',
        '-c life_os.identity_schema_rename_confirmation=blocked-by-uri',
      );
      const result = runMigrations(databaseUrl.toString());
      expect(result.status, result.stderr).toBe(0);

      const semanticState = psql(sourceUrl, databaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT to_regclass('identity.user_accounts') IS NOT NULL
             AND to_regclass('identity.identity_workspaces') IS NOT NULL
             AND to_regclass('identity.authentication_sessions') IS NOT NULL
             AND to_regclass('identity.users') IS NULL`,
      ]);
      expect(semanticState.status, semanticState.stderr).toBe(0);
      expect(semanticState.stdout.trim()).toBe('t');
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

  it('reconciles a committed semantic rename whose applying ledger row was not finalized', () => {
    const sourceUrl = requireLoopbackTestDatabaseUrl();
    const databaseName = `life_os_semantic_rename_${randomUUID().replaceAll('-', '')}`;
    const databaseIdentifier = quotedDatabase(databaseName);
    const databaseUrl = siblingDatabaseUrl(sourceUrl, databaseName);
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
      const historicalNames = migrationNames.filter((name) => name !== renameMigrationName);
      for (const migrationName of historicalNames) {
        const migrationPath = resolve(
          repositoryRoot,
          'apps/identity-service/migrations',
          migrationName,
        );
        const applyResult = psql(sourceUrl, databaseName, [
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
          return `('identity', '${migrationName}', ${Number(migrationName.slice(0, 4))}, '${migrationDigest(migrationPath)}', 'applied', clock_timestamp(), false)`;
        })
        .join(',\n');
      const renamePath = resolve(
        repositoryRoot,
        'apps/identity-service/migrations',
        renameMigrationName,
      );
      const ledgerResult = psql(sourceUrl, databaseName, [
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

      const renameResult = psql(
        sourceUrl,
        databaseName,
        ['--set=ON_ERROR_STOP=1', '--file', renamePath],
        {
          PGOPTIONS:
            '-c life_os.identity_schema_rename_confirmation=identity-service-drained',
        },
      );
      expect(renameResult.status, renameResult.stderr).toBe(0);

      const recovery = runMigrations(databaseUrl);
      expect(recovery.status, recovery.stderr).toBe(0);
      expect(recovery.stdout).toContain(
        `migration_status=recovered_committed service=identity migration=${renameMigrationName}`,
      );
      expect(recovery.stdout).not.toContain(
        `migration_status=retrying service=identity migration=${renameMigrationName}`,
      );

      const finalState = psql(sourceUrl, databaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT migration_status || ':' || migration_reconciled::text || ':' ||
                (to_regclass('identity.user_accounts') IS NOT NULL)::text || ':' ||
                (to_regclass('identity.users') IS NULL)::text
         FROM life_os_deployment.schema_migrations
         WHERE service_name = 'identity'
           AND migration_name = '${renameMigrationName}'`,
      ]);
      expect(finalState.status, finalState.stderr).toBe(0);
      expect(finalState.stdout.trim()).toBe('applied:true:true:true');
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
