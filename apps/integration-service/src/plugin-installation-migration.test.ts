import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '0001_plugin_installation_record.sql',
);
const MIGRATION_SQL = readFileSync(MIGRATION_PATH, 'utf8');
const DATABASE_URL =
  process.env.INTEGRATION_DATABASE_URL ?? process.env.PLANNING_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;

interface SqlExecution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Executes one isolated PostgreSQL client process against the disposable CI database. */
function executeSql(sql: string): SqlExecution {
  if (!DATABASE_URL) {
    throw new Error('A PostgreSQL test database URL is required');
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

/** Applies SQL and surfaces only bounded diagnostics when an expected setup fails. */
function requireSqlSuccess(sql: string): string {
  const result = executeSql(sql);
  if (result.status !== 0) {
    throw new Error(`PostgreSQL test setup failed: ${result.stderr.slice(0, 500)}`);
  }
  return result.stdout.trim();
}

/** Proves that a statement is rejected by the real PostgreSQL constraint boundary. */
function expectSqlFailure(sql: string): void {
  const result = executeSql(sql);
  expect(result.status).not.toBe(0);
}

describe('plugin installation migration contract', () => {
  it('uses descriptive multiword database names and stores authority evidence without secret material', () => {
    expect(MIGRATION_SQL).toContain(
      'CREATE SCHEMA IF NOT EXISTS plugin_integration',
    );
    expect(MIGRATION_SQL).toContain(
      'CREATE TABLE plugin_integration.plugin_installation_record',
    );
    for (const column of [
      'installation_id uuid PRIMARY KEY',
      'workspace_id uuid NOT NULL',
      'installed_by_user_id uuid NOT NULL',
      'plugin_id text NOT NULL',
      'plugin_contract_version text NOT NULL',
      'manifest_sha256 text NOT NULL',
      'granted_capabilities text[] NOT NULL',
      "installation_status text NOT NULL DEFAULT 'active'",
      'installed_at timestamptz NOT NULL',
      'revoked_at timestamptz',
    ]) {
      expect(MIGRATION_SQL).toContain(column);
    }
    expect(MIGRATION_SQL).not.toMatch(
      /\b(secret|token|credential|password)_/iu,
    );
  });
});

describeWithPostgres('plugin installation PostgreSQL constraints', () => {
  beforeEach(() => {
    requireSqlSuccess('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
    requireSqlSuccess(MIGRATION_SQL);
  });

  it('rejects impossible lifecycle, digest, and capability-count evidence', () => {
    const commonColumns = `
      installation_id, workspace_id, installed_by_user_id, plugin_id,
      plugin_contract_version, manifest_sha256, granted_capabilities,
      installation_status, installed_at, revoked_at`;
    const tooManyCapabilities = Array.from(
      { length: 33 },
      (_, index) => `'capability.${index}'`,
    ).join(', ');

    expectSqlFailure(`
      INSERT INTO plugin_integration.plugin_installation_record (${commonColumns})
      VALUES (
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'example.plugin', '1.0.0', '${'a'.repeat(64)}', ARRAY['task.completed'],
        'active', '2026-08-10T02:00:00.000Z', '2026-08-10T03:00:00.000Z'
      );
    `);

    expectSqlFailure(`
      INSERT INTO plugin_integration.plugin_installation_record (${commonColumns})
      VALUES (
        '11111111-1111-4111-8111-111111111112',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'example.plugin', '1.0.0', '${'a'.repeat(63)}', ARRAY['task.completed'],
        'active', '2026-08-10T02:00:00.000Z', NULL
      );
    `);

    expectSqlFailure(`
      INSERT INTO plugin_integration.plugin_installation_record (${commonColumns})
      VALUES (
        '11111111-1111-4111-8111-111111111113',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'example.plugin', '1.0.0', '${'a'.repeat(64)}', ARRAY[${tooManyCapabilities}],
        'active', '2026-08-10T02:00:00.000Z', NULL
      );
    `);
  });

  it('preserves one durable authority row across independent PostgreSQL client processes', () => {
    requireSqlSuccess(`
      INSERT INTO plugin_integration.plugin_installation_record (
        installation_id, workspace_id, installed_by_user_id, plugin_id,
        plugin_contract_version, manifest_sha256, granted_capabilities,
        installation_status, installed_at, revoked_at
      ) VALUES (
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
        '33333333-3333-4333-8333-333333333333',
        'example.plugin', '1.0.0', '${'a'.repeat(64)}', ARRAY['task.completed'],
        'active', '2026-08-10T02:00:00.000Z', NULL
      );
    `);

    const durable = requireSqlSuccess(`
      SELECT installation_id || '|' || workspace_id || '|' || installed_by_user_id || '|' || installation_status
      FROM plugin_integration.plugin_installation_record
      WHERE installation_id = '11111111-1111-4111-8111-111111111111'::uuid;
    `);
    expect(durable).toBe(
      '11111111-1111-4111-8111-111111111111|22222222-2222-4222-8222-222222222222|33333333-3333-4333-8333-333333333333|active',
    );
  });
});
