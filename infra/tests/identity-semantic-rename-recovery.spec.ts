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

/** Build libpq process state without exposing credentials in process arguments. */
function libpqEnvironment(
  sourceUrl: string,
  databaseName: string,
  environmentOverrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const parsedUrl = new URL(sourceUrl);
  const databaseEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: parsedUrl.hostname,
    PGPORT: parsedUrl.port || '5432',
    PGUSER: decodeURIComponent(parsedUrl.username),
    PGPASSWORD: decodeURIComponent(parsedUrl.password),
    PGDATABASE: databaseName,
  };
  const sslMode = parsedUrl.searchParams.get('sslmode');
  if (sslMode) {
    databaseEnvironment.PGSSLMODE = sslMode;
  }
  return {
    ...databaseEnvironment,
    ...environmentOverrides,
  };
}

describe('Identity semantic rename libpq environment', () => {
  it('preserves the source SSL mode for psql helpers', () => {
    const databaseEnvironment = libpqEnvironment(
      'postgresql://tester:secret@localhost:5432/life_os_test?sslmode=verify-full',
      'life_os_test',
    );

    expect(databaseEnvironment.PGSSLMODE).toBe('verify-full');
  });
});

/** Execute psql with bounded runtime and no credential-bearing URI argument. */
function psql(
  sourceUrl: string,
  databaseName: string,
  psqlArguments: string[],
  environmentOverrides: NodeJS.ProcessEnv = {},
) {
  return spawnSync('psql', ['--no-psqlrc', '--no-password', ...psqlArguments], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: libpqEnvironment(sourceUrl, databaseName, environmentOverrides),
    timeout: 30_000,
  });
}

/** Return a sibling database URL without putting credentials in runner arguments. */
function siblingDatabaseUrl(sourceUrl: string, databaseName: string): string {
  const parsedUrl = new URL(sourceUrl);
  parsedUrl.pathname = `/${databaseName}`;
  return parsedUrl.toString();
}

/** Quote only a locally generated temporary database identifier. */
function quotedDatabase(databaseName: string): string {
  if (!temporaryDatabasePattern.test(databaseName)) {
    throw new Error('Temporary semantic rename database name is invalid');
  }
  return `"${databaseName}"`;
}

/** Return the immutable digest recorded by the migration runner. */
function migrationDigest(migrationPath: string): string {
  return createHash('sha256').update(readFileSync(migrationPath)).digest('hex');
}

/** List Identity migrations in the same C-compatible filename order as production. */
function identityMigrations(): string[] {
  return readdirSync(resolve(repositoryRoot, 'apps/identity-service/migrations'))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .sort();
}

/** Apply pre-rename Identity history and seed an exact applying deployment receipt. */
function prepareCommittedRename(
  sourceUrl: string,
  databaseName: string,
): { databaseUrl: string; renamePath: string } {
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

  return {
    databaseUrl: siblingDatabaseUrl(sourceUrl, databaseName),
    renamePath,
  };
}

/** Execute the production migration runner against one disposable database. */
function runMigrationRecovery(databaseUrl: string) {
  const runnerEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    LIFE_OS_MIGRATION_CONFIRMATION: 'apply-forward-only',
    PGOPTIONS:
      '-c life_os.identity_schema_rename_confirmation=identity-service-drained',
    IDENTITY_DATABASE_URL: databaseUrl,
    PLANNING_DATABASE_URL: databaseUrl,
    HABIT_DATABASE_URL: databaseUrl,
    AI_DATABASE_URL: databaseUrl,
    REVIEW_DATABASE_URL: databaseUrl,
  };
  return spawnSync(
    'bash',
    [resolve(kubernetesRoot, 'run-migrations.sh')],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: runnerEnvironment,
      timeout: 60_000,
    },
  );
}

describeWithDatabase('Identity semantic rename runner-owned recovery', () => {
  it('keeps deployment ledger authority in the runner and recovers a committed rename', () => {
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

      const { databaseUrl } = prepareCommittedRename(sourceUrl, databaseName);
      const interruptedState = psql(sourceUrl, databaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT migration_status || ':' || (applied_at IS NULL)::text || ':' ||
                (to_regclass('identity.user_accounts') IS NOT NULL)::text || ':' ||
                (to_regclass('identity.users') IS NULL)::text
         FROM life_os_deployment.schema_migrations
         WHERE service_name = 'identity'
           AND migration_name = '${renameMigrationName}'`,
      ]);
      expect(interruptedState.status, interruptedState.stderr).toBe(0);
      expect(interruptedState.stdout.trim()).toBe('applying:true:true:true');

      const recoveryResult = runMigrationRecovery(databaseUrl);
      expect(recoveryResult.status, recoveryResult.stderr).toBe(0);
      expect(recoveryResult.stdout).toContain(
        `migration_status=reconciled service=identity migration=${renameMigrationName}`,
      );

      const recoveredState = psql(sourceUrl, databaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT migration_status || ':' || (applied_at IS NOT NULL)::text || ':' ||
                migration_reconciled::text || ':' ||
                (to_regclass('identity.user_accounts') IS NOT NULL)::text || ':' ||
                (to_regclass('identity.users') IS NULL)::text
         FROM life_os_deployment.schema_migrations
         WHERE service_name = 'identity'
           AND migration_name = '${renameMigrationName}'`,
      ]);
      expect(recoveredState.status, recoveredState.stderr).toBe(0);
      expect(recoveredState.stdout.trim()).toBe('applied:true:true:true:true');
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

  it('rejects expected semantic names attached to the wrong database objects', () => {
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

      const { databaseUrl } = prepareCommittedRename(sourceUrl, databaseName);
      const spoofResult = psql(sourceUrl, databaseName, [
        '--set=ON_ERROR_STOP=1',
        '--command',
        `ALTER TABLE identity.user_accounts
           RENAME CONSTRAINT user_accounts_pkey TO unexpected_user_accounts_pkey;
         ALTER TABLE identity.external_identities
           ADD CONSTRAINT user_accounts_pkey CHECK (true);
         ALTER INDEX identity.external_identities_user_account_idx
           RENAME TO unexpected_external_identities_user_account_idx;
         CREATE INDEX external_identities_user_account_idx
           ON identity.user_accounts (user_account_id);`,
      ]);
      expect(spoofResult.status, spoofResult.stderr).toBe(0);

      const recoveryResult = runMigrationRecovery(databaseUrl);
      expect(recoveryResult.status).not.toBe(0);
      expect(recoveryResult.stderr).toContain('service_migration_failed:identity');

      const ledgerState = psql(sourceUrl, databaseName, [
        '--tuples-only',
        '--no-align',
        '--command',
        `SELECT migration_status || ':' || (applied_at IS NULL)::text || ':' ||
                migration_reconciled::text
         FROM life_os_deployment.schema_migrations
         WHERE service_name = 'identity'
           AND migration_name = '${renameMigrationName}'`,
      ]);
      expect(ledgerState.status, ledgerState.stderr).toBe(0);
      expect(ledgerState.stdout.trim()).toBe('applying:true:false');
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
