import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const INSTALLATION_MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '0001_plugin_installation_record.sql',
);
const CREDENTIAL_MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '0002_plugin_credential_binding_record.sql',
);
const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;

interface SqlExecution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function credentialMigrationSql(): string {
  return readFileSync(CREDENTIAL_MIGRATION_PATH, 'utf8');
}

function executeSql(sql: string): SqlExecution {
  if (!DATABASE_URL) {
    throw new Error('An integration PostgreSQL URL is required');
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
      env: {
        ...process.env,
        PGPASSWORD: decodeURIComponent(target.password),
      },
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

function requireSqlSuccess(sql: string): string {
  const result = executeSql(sql);
  if (result.status !== 0) {
    throw new Error(`Plugin credential PostgreSQL setup failed: ${result.stderr.slice(0, 500)}`);
  }
  return result.stdout.trim();
}

function expectSqlFailure(sql: string): void {
  expect(executeSql(sql).status).not.toBe(0);
}

describe('plugin credential binding migration contract', () => {
  it('persists only bounded opaque secret references in a descriptive service-owned table', () => {
    const sql = credentialMigrationSql();
    expect(sql).toContain(
      'CREATE TABLE plugin_integration.plugin_credential_binding_record',
    );
    for (const column of [
      'credential_binding_id uuid PRIMARY KEY',
      'installation_id uuid NOT NULL',
      'workspace_id uuid NOT NULL',
      'installed_by_user_id uuid NOT NULL',
      'credential_name text NOT NULL',
      'secret_reference text NOT NULL',
      "credential_status text NOT NULL DEFAULT 'active'",
      'bound_at timestamptz NOT NULL',
      'revoked_at timestamptz',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('REFERENCES plugin_integration.plugin_installation_record');
    expect(sql).not.toMatch(/\b(secret_value|plaintext_secret|access_token|refresh_token|password)\b/iu);
  });
});

describeWithPostgres('plugin credential PostgreSQL constraints', () => {
  beforeEach(() => {
    requireSqlSuccess('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
    requireSqlSuccess(readFileSync(INSTALLATION_MIGRATION_PATH, 'utf8'));
    requireSqlSuccess(credentialMigrationSql());
    requireSqlSuccess(`
      INSERT INTO plugin_integration.plugin_installation_record (
        installation_id, workspace_id, installed_by_user_id, plugin_id,
        plugin_contract_version, manifest_sha256, granted_capabilities,
        installation_status, installed_at
      ) VALUES (
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'example.plugin', '1.0.0', '${'a'.repeat(64)}', ARRAY['lifeos.task.completed.v1'],
        'active', '2026-08-10T06:00:00.000Z'
      );
    `);
  });

  it('accepts one installer-scoped opaque binding and preserves no plaintext secret column', () => {
    requireSqlSuccess(`
      INSERT INTO plugin_integration.plugin_credential_binding_record (
        credential_binding_id, installation_id, workspace_id,
        installed_by_user_id, credential_name, secret_reference,
        credential_status, bound_at
      ) VALUES (
        '44444444-4444-4444-8444-444444444444',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'webhook.signing', 'kms://life-os/plugin/opaque-reference-001',
        'active', '2026-08-10T07:00:00.000Z'
      );
    `);
    const row = requireSqlSuccess(`
      SELECT credential_binding_id || '|' || workspace_id || '|' || installed_by_user_id || '|' || credential_status
      FROM plugin_integration.plugin_credential_binding_record;
    `);
    expect(row).toBe(
      '44444444-4444-4444-8444-444444444444|22222222-2222-4222-8222-222222222222|33333333-3333-4333-8333-333333333333|active',
    );
  });

  it('rejects cross-installation authority, malformed references, and impossible lifecycle evidence', () => {
    for (const values of [
      `
        '44444444-4444-4444-8444-444444444441',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'webhook.signing', 'kms://life-os/plugin/opaque-reference-001',
        'active', '2026-08-10T07:00:00.000Z', NULL
      `,
      `
        '44444444-4444-4444-8444-444444444442',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'webhook.signing', 'short',
        'active', '2026-08-10T07:00:00.000Z', NULL
      `,
      `
        '44444444-4444-4444-8444-444444444443',
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'webhook.signing', 'kms://life-os/plugin/opaque-reference-003',
        'active', '2026-08-10T07:00:00.000Z', '2026-08-10T08:00:00.000Z'
      `,
    ]) {
      expectSqlFailure(`
        INSERT INTO plugin_integration.plugin_credential_binding_record (
          credential_binding_id, installation_id, workspace_id,
          installed_by_user_id, credential_name, secret_reference,
          credential_status, bound_at, revoked_at
        ) VALUES (${values});
      `);
    }
  });
});
