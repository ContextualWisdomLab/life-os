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
const REPLAY_MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '0003_plugin_operator_context_replay_record.sql',
);
const DATABASE_URL = process.env.INTEGRATION_DATABASE_URL;
const describeWithPostgres = DATABASE_URL ? describe : describe.skip;

interface SqlExecution {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function replayMigrationSql(): string {
  return readFileSync(REPLAY_MIGRATION_PATH, 'utf8');
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
    throw new Error(
      `Plugin operator replay PostgreSQL setup failed: ${result.stderr.slice(0, 500)}`,
    );
  }
  return result.stdout.trim();
}

function expectSqlFailure(sql: string): void {
  expect(executeSql(sql).status).not.toBe(0);
}

describe('plugin operator replay migration contract', () => {
  it('owns only the bounded one-time evidence identity and lifetime in Integration persistence', () => {
    const sql = replayMigrationSql();
    expect(sql).toContain(
      'CREATE TABLE plugin_integration.plugin_operator_context_replay_record',
    );
    for (const column of [
      'evidence_id uuid PRIMARY KEY',
      'consumed_at timestamptz NOT NULL',
      'expires_at timestamptz NOT NULL',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).toContain('CHECK (expires_at >= consumed_at)');
    expect(sql).toContain(
      'ON plugin_integration.plugin_operator_context_replay_record (expires_at)',
    );
    for (const documentedContract of [
      'COMMENT ON TABLE plugin_integration.plugin_operator_context_replay_record',
      'COMMENT ON COLUMN plugin_integration.plugin_operator_context_replay_record.evidence_id',
      'COMMENT ON COLUMN plugin_integration.plugin_operator_context_replay_record.consumed_at',
      'COMMENT ON COLUMN plugin_integration.plugin_operator_context_replay_record.expires_at',
    ]) {
      expect(sql).toContain(documentedContract);
    }
    expect(sql).not.toMatch(
      /^\s*(workspace_id|user_id|installed_by_user_id|signature|secret|token|password)\s+[a-z]/imu,
    );
  });
});

describeWithPostgres('plugin operator replay PostgreSQL constraints', () => {
  beforeEach(() => {
    requireSqlSuccess('DROP SCHEMA IF EXISTS plugin_integration CASCADE;');
    requireSqlSuccess(readFileSync(INSTALLATION_MIGRATION_PATH, 'utf8'));
    requireSqlSuccess(readFileSync(CREDENTIAL_MIGRATION_PATH, 'utf8'));
    requireSqlSuccess(replayMigrationSql());
  });

  it('permits exactly one durable winner for a UUIDv4 evidence identity', () => {
    requireSqlSuccess(`
      INSERT INTO plugin_integration.plugin_operator_context_replay_record (
        evidence_id, consumed_at, expires_at
      ) VALUES (
        '77777777-7777-4777-8777-777777777777',
        '2026-08-11T14:35:00.000Z',
        '2026-08-11T14:36:00.000Z'
      );
    `);
    expectSqlFailure(`
      INSERT INTO plugin_integration.plugin_operator_context_replay_record (
        evidence_id, consumed_at, expires_at
      ) VALUES (
        '77777777-7777-4777-8777-777777777777',
        '2026-08-11T14:35:01.000Z',
        '2026-08-11T14:36:01.000Z'
      );
    `);
    expect(
      requireSqlSuccess(`
        SELECT count(*)
        FROM plugin_integration.plugin_operator_context_replay_record
        WHERE evidence_id = '77777777-7777-4777-8777-777777777777'::uuid;
      `),
    ).toBe('1');
  });

  it('accepts a zero-length retention boundary when consumption and expiry are identical', () => {
    requireSqlSuccess(`
      INSERT INTO plugin_integration.plugin_operator_context_replay_record (
        evidence_id, consumed_at, expires_at
      ) VALUES (
        '99999999-9999-4999-8999-999999999999',
        '2026-08-11T14:35:00.000Z',
        '2026-08-11T14:35:00.000Z'
      );
    `);
    expect(
      requireSqlSuccess(`
        SELECT count(*)
        FROM plugin_integration.plugin_operator_context_replay_record
        WHERE evidence_id = '99999999-9999-4999-8999-999999999999'::uuid;
      `),
    ).toBe('1');
  });

  it('rejects replay lifetimes that expire before consumption', () => {
    expectSqlFailure(`
      INSERT INTO plugin_integration.plugin_operator_context_replay_record (
        evidence_id, consumed_at, expires_at
      ) VALUES (
        '88888888-8888-4888-8888-888888888888',
        '2026-08-11T14:35:00.000Z',
        '2026-08-11T14:34:59.999Z'
      );
    `);
  });
});
