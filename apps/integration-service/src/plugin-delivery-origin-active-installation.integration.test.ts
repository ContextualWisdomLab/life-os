import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;
const MIGRATIONS = [
  '0001_plugin_installation_record.sql',
  '0002_plugin_credential_binding_record.sql',
  '0003_plugin_operator_context_replay_record.sql',
  '0004_plugin_delivery_origin_grant_record.sql',
].map((name) => readFileSync(join(__dirname, '..', 'migrations', name), 'utf8'));
const DELIVERY_ORIGIN_MIGRATION = MIGRATIONS.at(-1) ?? '';

interface SqlExecution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Executes one bounded psql process against the disposable Integration database. */
function executeSql(sql: string): SqlExecution {
  if (!DATABASE_URL) {
    throw new Error('A dedicated PostgreSQL integration test database URL is required');
  }
  const target = new URL(DATABASE_URL);
  const result = spawnSync(
    'psql',
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      target.hostname,
      '-p',
      target.port || '5432',
      '-U',
      decodeURIComponent(target.username),
      '-d',
      decodeURIComponent(target.pathname.replace(/^\//u, '')),
      '-Atq',
    ],
    {
      input: sql,
      encoding: 'utf8',
      env: { ...process.env, PGPASSWORD: decodeURIComponent(target.password) },
    },
  );
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Applies fixed setup SQL and exposes only bounded diagnostics on failure. */
function requireSqlSuccess(sql: string): void {
  const result = executeSql(sql);
  if (result.status !== 0) {
    throw new Error(`PostgreSQL test setup failed: ${result.stderr.slice(0, 500)}`);
  }
}

const INSTALLATION_SQL = `
  INSERT INTO plugin_integration.plugin_installation_record (
    installation_id, workspace_id, installed_by_user_id, plugin_id,
    plugin_contract_version, manifest_sha256, granted_capabilities,
    installation_status, installed_at, revoked_at
  ) VALUES (
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    'example.plugin', '1.0.0', repeat('a', 64), ARRAY['delivery.https'],
    'active', '2026-09-01T19:00:00.000Z', NULL
  );
`;

const GRANT_SQL = `
  INSERT INTO plugin_integration.plugin_delivery_origin_grant_record (
    authority_version, grant_id, installation_id, workspace_id,
    granted_by_user_id, origin_uri, grant_status, granted_at, revoked_at
  ) VALUES (
    'life-os.plugin-delivery-origin.v1',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    'https://api.example.com:8443', 'active', '2026-09-01T20:00:00.000Z', NULL
  );
`;

describeWithPostgres('plugin delivery-origin active-installation persistence fence', () => {
  beforeEach(() => {
    requireSqlSuccess('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
    requireSqlSuccess(MIGRATIONS.join('\n'));
    requireSqlSuccess(INSTALLATION_SQL);
  });

  it('rejects a new origin grant after the owning installation is durably revoked', () => {
    requireSqlSuccess(`
      UPDATE plugin_integration.plugin_installation_record
      SET installation_status = 'revoked',
          revoked_at = '2026-09-01T19:30:00.000Z'
      WHERE installation_id = '22222222-2222-4222-8222-222222222222'::uuid;
    `);

    const result = executeSql(GRANT_SQL);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'plugin_delivery_origin_active_installation_check',
    );
  });

  it('locks the active installation row while admitting a grant to serialize revocation', () => {
    expect(DELIVERY_ORIGIN_MIGRATION).toContain('FOR SHARE');
  });
});
