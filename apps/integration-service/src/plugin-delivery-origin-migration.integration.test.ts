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

interface SqlExecution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one isolated PostgreSQL client process against the disposable integration database. */
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

/** Applies fixed SQL while exposing only bounded diagnostics for failed test setup. */
function requireSqlSuccess(sql: string): string {
  const result = executeSql(sql);
  if (result.status !== 0) {
    throw new Error(`PostgreSQL test setup failed: ${result.stderr.slice(0, 500)}`);
  }
  return result.stdout.trim();
}

/** Verifies one database invariant rejects the fixed hostile fixture by constraint identity. */
function expectSqlFailure(sql: string, expectedConstraint: string): void {
  const result = executeSql(sql);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(expectedConstraint);
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

describeWithPostgres('plugin delivery-origin PostgreSQL lifecycle', () => {
  beforeEach(() => {
    requireSqlSuccess('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
    requireSqlSuccess(MIGRATIONS.join('\n'));
    requireSqlSuccess(INSTALLATION_SQL);
  });

  it('persists one tenant-scoped grant across independent PostgreSQL processes and revokes it monotonically', () => {
    requireSqlSuccess(GRANT_SQL);
    expect(
      requireSqlSuccess(`
        SELECT grant_id || '|' || installation_id || '|' || workspace_id || '|' ||
               granted_by_user_id || '|' || origin_uri || '|' || grant_status
        FROM plugin_integration.plugin_delivery_origin_grant_record
        WHERE grant_id = '11111111-1111-4111-8111-111111111111'::uuid;
      `),
    ).toBe(
      '11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|33333333-3333-4333-8333-333333333333|44444444-4444-4444-8444-444444444444|https://api.example.com:8443|active',
    );

    requireSqlSuccess(`
      UPDATE plugin_integration.plugin_delivery_origin_grant_record
      SET grant_status = 'revoked', revoked_at = '2026-09-01T21:00:00.000Z'
      WHERE grant_id = '11111111-1111-4111-8111-111111111111'::uuid;
    `);
    expect(
      requireSqlSuccess(`
        SELECT grant_status || '|' || to_char(revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        FROM plugin_integration.plugin_delivery_origin_grant_record
        WHERE grant_id = '11111111-1111-4111-8111-111111111111'::uuid;
      `),
    ).toBe('revoked|2026-09-01T21:00:00.000Z');
  });

  it('rejects foreign installation authority, downgraded origins, wrong versions, UUIDv7, and impossible lifecycle evidence', () => {
    expectSqlFailure(
      GRANT_SQL.replace(
        "'22222222-2222-4222-8222-222222222222'",
        "'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'",
      ),
      'plugin_delivery_origin_installation_authority_fk',
    );
    expectSqlFailure(
      GRANT_SQL.replace('https://api.example.com:8443', 'http://api.example.com'),
      'plugin_delivery_origin_uri_format_check',
    );
    expectSqlFailure(
      GRANT_SQL.replace('life-os.plugin-delivery-origin.v1', 'life-os.plugin-delivery-origin.v2'),
      'plugin_delivery_origin_authority_version_check',
    );
    expectSqlFailure(
      GRANT_SQL.replace(
        '11111111-1111-4111-8111-111111111111',
        '11111111-1111-7111-8111-111111111111',
      ),
      'plugin_delivery_origin_grant_id_uuid_v4_check',
    );
    expectSqlFailure(
      GRANT_SQL.replace(
        "'active', '2026-09-01T20:00:00.000Z', NULL",
        "'revoked', '2026-09-01T20:00:00.000Z', '2026-09-01T19:59:59.000Z'",
      ),
      'plugin_delivery_origin_revocation_time_check',
    );
  });
});
