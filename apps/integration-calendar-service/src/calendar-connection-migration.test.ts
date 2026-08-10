import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = join(
  process.cwd(),
  'migrations',
  '0001_calendar_connection_record.sql',
);

describe('calendar connection migration', () => {
  it('persists tenant-scoped connection metadata in a descriptive multiword schema without plaintext token columns', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS calendar_integration');
    expect(sql).toContain(
      'CREATE TABLE calendar_integration.calendar_connection_record',
    );
    expect(sql).not.toContain('CREATE SCHEMA IF NOT EXISTS calendar;');
    for (const column of [
      'connection_id uuid PRIMARY KEY',
      'workspace_id uuid NOT NULL',
      'user_id uuid NOT NULL',
      'provider_code text NOT NULL',
      'provider_account_subject text NOT NULL',
      'scope_values text[] NOT NULL',
      'access_secret_handle text NOT NULL',
      'refresh_secret_handle text',
      'token_expires_at timestamptz NOT NULL',
      'selected_calendar_identifier text NOT NULL',
      'connection_status text NOT NULL',
      'created_at timestamptz NOT NULL',
      'updated_at timestamptz NOT NULL',
      'revoked_at timestamptz',
    ]) {
      expect(sql).toContain(column);
    }

    expect(sql).toContain("provider_code IN ('google', 'caldav')");
    expect(sql).toContain("connection_status IN ('active', 'revoked')");
    expect(sql).toContain('cardinality(scope_values) BETWEEN 1 AND 32');
    expect(sql).toContain('token_expires_at > created_at');
    expect(sql).toContain("connection_status = 'active' AND revoked_at IS NULL");
    expect(sql).toContain("connection_status = 'revoked' AND revoked_at IS NOT NULL");
    expect(sql).toContain(
      'UNIQUE (workspace_id, user_id, provider_code, provider_account_subject, selected_calendar_identifier)',
    );
    expect(sql).not.toMatch(/\baccess_token\b/iu);
    expect(sql).not.toMatch(/\brefresh_token\b/iu);
  });
});
