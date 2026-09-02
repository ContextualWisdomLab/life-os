import { spawnSync } from 'node:child_process';

const IDENTITY_RENAME_CONFIRMATION =
  '-c life_os.identity_schema_rename_confirmation=identity-service-drained';

/**
 * Executes one Identity migration with the same psql semantics required by production.
 * Migration 0007 contains psql control commands and refuses its breaking schema rename
 * unless the Identity service-drain confirmation is present. Integration suites use
 * this helper so they cannot bypass either boundary by submitting migration text
 * directly through node-postgres. Credentials remain in libpq environment variables
 * rather than process arguments, and any migration failure aborts the test setup.
 */
export function applyIdentityMigration(
  databaseUrl: string,
  migrationSql: string,
): void {
  const target = new URL(databaseUrl);
  const databaseName = decodeURIComponent(target.pathname.replace(/^\//u, ''));
  if (!target.hostname || !target.username || !databaseName) {
    throw new Error('Identity migration test database URL is incomplete');
  }

  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: target.hostname,
    PGPORT: target.port || '5432',
    PGUSER: decodeURIComponent(target.username),
    PGPASSWORD: decodeURIComponent(target.password),
    PGDATABASE: databaseName,
    PGOPTIONS: IDENTITY_RENAME_CONFIRMATION,
  };
  const sslMode = target.searchParams.get('sslmode');
  if (sslMode) environment.PGSSLMODE = sslMode;

  const result = spawnSync(
    'psql',
    ['--no-psqlrc', '--no-password', '--set=ON_ERROR_STOP=1', '--quiet'],
    {
      input: migrationSql,
      encoding: 'utf8',
      env: environment,
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Identity PostgreSQL migration setup failed: ${result.stderr.slice(0, 500)}`,
    );
  }
}
