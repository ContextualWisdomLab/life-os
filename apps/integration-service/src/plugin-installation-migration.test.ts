import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = join(
  process.cwd(),
  'migrations',
  '0001_plugin_installation_record.sql',
);

describe('plugin installation migration', () => {
  it('uses descriptive multiword database names and stores authority evidence without secret material', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS plugin_integration');
    expect(sql).toContain(
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
      expect(sql).toContain(column);
    }
    expect(sql).toContain("installation_status IN ('active', 'revoked')");
    expect(sql).toContain('cardinality(granted_capabilities) BETWEEN 0 AND 32');
    expect(sql).toContain('char_length(manifest_sha256) = 64');
    expect(sql).toContain("manifest_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain("installation_status = 'active' AND revoked_at IS NULL");
    expect(sql).toContain("installation_status = 'revoked' AND revoked_at IS NOT NULL");
    expect(sql).not.toMatch(/\b(secret|token|credential|password)_/iu);
  });
});
