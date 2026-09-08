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
  '0005_plugin_credential_active_installation_guard.sql',
  '0006_plugin_delivery_attempt_record.sql',
].map((name) =>
  readFileSync(join(__dirname, '..', 'migrations', name), 'utf8'),
);

interface SqlExecution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs one isolated PostgreSQL client process against the disposable Integration database. */
function executeSql(sql: string): SqlExecution {
  if (!DATABASE_URL) {
    throw new Error(
      'A dedicated PostgreSQL integration test database URL is required',
    );
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
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Applies fixed SQL while exposing only bounded diagnostics for failed test setup. */
function requireSqlSuccess(sql: string): string {
  const result = executeSql(sql);
  if (result.status !== 0) {
    throw new Error(
      `PostgreSQL test setup failed: ${result.stderr.slice(0, 500)}`,
    );
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
    'active', '2026-09-08T04:00:00.000Z', NULL
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
    'https://api.example.com', 'active', '2026-09-08T04:10:00.000Z', NULL
  );
`;

const ATTEMPT_SQL = `
  INSERT INTO plugin_integration.plugin_delivery_attempt_record (
    authority_version, delivery_id, grant_id, installation_id, workspace_id,
    requested_by_user_id, delivery_status, attempt_count, max_attempts,
    requested_at, updated_at, next_attempt_at, terminal_at, last_outcome_code
  ) VALUES (
    'life-os.plugin-delivery-attempt.v1',
    '55555555-5555-4555-8555-555555555555',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    'pending', 0, 4,
    '2026-09-08T04:20:00.000Z',
    '2026-09-08T04:20:00.000Z',
    '2026-09-08T04:20:00.000Z',
    NULL, NULL
  );
`;

describeWithPostgres('plugin delivery-attempt PostgreSQL admission', () => {
  beforeEach(() => {
    requireSqlSuccess('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
    requireSqlSuccess(MIGRATIONS.join('\n'));
    requireSqlSuccess(INSTALLATION_SQL);
    requireSqlSuccess(GRANT_SQL);
  });

  it('persists only opaque scheduling authority across PostgreSQL processes', () => {
    requireSqlSuccess(ATTEMPT_SQL);
    expect(
      requireSqlSuccess(`
        SELECT delivery_id || '|' || grant_id || '|' || installation_id || '|' ||
               workspace_id || '|' || requested_by_user_id || '|' || delivery_status || '|' ||
               attempt_count || '|' || max_attempts
        FROM plugin_integration.plugin_delivery_attempt_record
        WHERE delivery_id = '55555555-5555-4555-8555-555555555555'::uuid;
      `),
    ).toBe(
      '55555555-5555-4555-8555-555555555555|11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|33333333-3333-4333-8333-333333333333|44444444-4444-4444-8444-444444444444|pending|0|4',
    );
    expect(
      requireSqlSuccess(`
        SELECT count(*)
        FROM information_schema.columns
        WHERE table_schema = 'plugin_integration'
          AND table_name = 'plugin_delivery_attempt_record'
          AND column_name IN ('origin_uri', 'credential', 'payload', 'request_body');
      `),
    ).toBe('0');
  });

  it('rejects admission after delivery-origin revocation at the durable insertion boundary', () => {
    requireSqlSuccess(`
      UPDATE plugin_integration.plugin_delivery_origin_grant_record
      SET grant_status = 'revoked', revoked_at = '2026-09-08T04:15:00.000Z'
      WHERE grant_id = '11111111-1111-4111-8111-111111111111'::uuid;
    `);
    expectSqlFailure(
      ATTEMPT_SQL,
      'plugin_delivery_attempt_active_authority_check',
    );
  });

  it('rejects admission after installation revocation even when the origin grant row remains active', () => {
    requireSqlSuccess(`
      UPDATE plugin_integration.plugin_installation_record
      SET installation_status = 'revoked', revoked_at = '2026-09-08T04:15:00.000Z'
      WHERE installation_id = '22222222-2222-4222-8222-222222222222'::uuid;
    `);
    expectSqlFailure(
      ATTEMPT_SQL,
      'plugin_delivery_attempt_active_authority_check',
    );
  });

  it('rejects impossible retry limits and UUID versions before a worker can observe them', () => {
    expectSqlFailure(
      ATTEMPT_SQL.replace("'pending', 0, 4", "'pending', 0, 0"),
      'plugin_delivery_attempt_max_attempts_check',
    );
    expectSqlFailure(
      ATTEMPT_SQL.replace(
        '55555555-5555-4555-8555-555555555555',
        '55555555-5555-7555-8555-555555555555',
      ),
      'plugin_delivery_attempt_delivery_id_uuid_v4_check',
    );
  });
});
