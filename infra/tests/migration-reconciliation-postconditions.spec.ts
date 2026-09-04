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
const temporaryDatabasePattern = /^life_os_reconciliation_[0-9a-f]{32}$/u;
const describeWithDatabase = identityDatabaseUrl ? describe : describe.skip;

/** Requires a disposable loopback PostgreSQL database supplied by CI. */
function requireLoopbackTestDatabaseUrl(): string {
  if (!identityDatabaseUrl) throw new Error('IDENTITY_DATABASE_URL is required');
  const parsedUrl = new URL(identityDatabaseUrl);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (
    !loopbackHosts.has(parsedUrl.hostname) ||
    !testDatabasePattern.test(databaseName)
  ) {
    throw new Error('Migration reconciliation requires a loopback PostgreSQL test database');
  }
  return identityDatabaseUrl;
}

/** Builds libpq process state without exposing credentials in process arguments. */
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

/** Executes psql with bounded runtime and no connection URI in argv. */
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

/** Quotes only a locally generated test database identifier. */
function quotedDatabase(databaseName: string): string {
  if (!temporaryDatabasePattern.test(databaseName)) {
    throw new Error('Temporary reconciliation database name is invalid');
  }
  return `"${databaseName}"`;
}

/** Returns a sibling database URL using the same loopback connection authority. */
function siblingDatabaseUrl(sourceUrl: string, databaseName: string): string {
  const parsedUrl = new URL(sourceUrl);
  parsedUrl.pathname = `/${databaseName}`;
  return parsedUrl.toString();
}

/** Computes the digest recorded by the production migration ledger. */
function migrationDigest(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** Lists canonical Identity migration names before the semantic rename. */
function historicalIdentityMigrations(): string[] {
  return readdirSync(resolve(repositoryRoot, 'apps/identity-service/migrations'))
    .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/u.test(name))
    .filter((name) => Number(name.slice(0, 4)) <= 6)
    .sort();
}

/** Builds a complete ledger except for the historical migration being reconciled. */
function ledgerRowsExcluding(excludedMigration: string): string {
  return historicalIdentityMigrations()
    .filter((migrationName) => migrationName !== excludedMigration)
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
}

/** Runs the production migration runner against one disposable database. */
function runMigrations(databaseUrl: string) {
  return spawnSync('bash', [resolve(kubernetesRoot, 'run-migrations.sh')], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      LIFE_OS_MIGRATION_CONFIRMATION: 'apply-forward-only',
      IDENTITY_DATABASE_URL: databaseUrl,
      PLANNING_DATABASE_URL: databaseUrl,
      HABIT_DATABASE_URL: databaseUrl,
      AI_DATABASE_URL: databaseUrl,
      REVIEW_DATABASE_URL: databaseUrl,
    },
    timeout: 60_000,
  });
}

/** Creates a full pre-0007 schema, mutates one postcondition, and executes an assertion. */
function withPartialHistoricalSchema(
  excludedMigration: string,
  partialSchemaSql: string,
  assertion: (result: ReturnType<typeof runMigrations>) => void,
): void {
  const sourceUrl = requireLoopbackTestDatabaseUrl();
  const temporaryDatabaseName = `life_os_reconciliation_${randomUUID().replaceAll('-', '')}`;
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

    for (const migrationName of historicalIdentityMigrations()) {
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
       VALUES ${ledgerRowsExcluding(excludedMigration)};
       ${partialSchemaSql}`,
    ]);
    expect(ledgerResult.status, ledgerResult.stderr).toBe(0);

    assertion(runMigrations(temporaryUrl));
  } finally {
    if (databaseCreated) {
      const dropResult = psql(sourceUrl, adminDatabaseName, [
        '--command',
        `DROP DATABASE ${databaseIdentifier}`,
      ]);
      expect(dropResult.status, dropResult.stderr).toBe(0);
    }
  }
}

/** Requires a historical reconciliation to fail closed on a partial schema. */
function expectRejectedPartialSchema(
  excludedMigration: string,
  partialSchemaSql: string,
): void {
  withPartialHistoricalSchema(excludedMigration, partialSchemaSql, (result) => {
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      `migration_error=migration_name_not_forward service=identity migration=${excludedMigration}`,
    );
  });
}

describeWithDatabase('legacy migration reconciliation postconditions', () => {
  it('rejects OAuth key-version history missing the provider metadata invariant', () => {
    expectRejectedPartialSchema(
      '0004_oauth_secret_key_versions.sql',
      `ALTER TABLE identity.oauth_transactions
         DROP CONSTRAINT oauth_nonce_encryption_metadata_by_provider;`,
    );
  }, 120_000);

  it('rejects an authentication-age history whose retained constraint has the wrong definition', () => {
    expectRejectedPartialSchema(
      '0004_session_authentication_age.sql',
      `ALTER TABLE identity.sessions
         DROP CONSTRAINT sessions_authentication_not_after_creation;
       ALTER TABLE identity.sessions
         ADD CONSTRAINT sessions_authentication_not_after_creation CHECK (true);`,
    );
  }, 120_000);

  it('rejects a finalize-history marker when the retained authentication constraint is not validated', () => {
    expectRejectedPartialSchema(
      '0005_finalize_session_authentication_age.sql',
      `ALTER TABLE identity.sessions
         DROP CONSTRAINT sessions_authentication_not_after_creation;
       ALTER TABLE identity.sessions
         ADD CONSTRAINT sessions_authentication_not_after_creation
         CHECK (authenticated_at <= created_at) NOT VALID;`,
    );
  }, 120_000);

  it('rejects UUIDv4 history when a named constraint no longer enforces UUIDv4', () => {
    expectRejectedPartialSchema(
      '0005_opaque_uuid_v4_identifiers.sql',
      `ALTER TABLE identity.sessions DROP CONSTRAINT sessions_id_uuid_v4;
       ALTER TABLE identity.sessions
         ADD CONSTRAINT sessions_id_uuid_v4 CHECK (true);`,
    );
  }, 120_000);
});
