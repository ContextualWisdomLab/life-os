import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PluginDeliveryOriginGrantRecord } from './plugin-delivery-origin-authority';
import {
  PluginDeliveryOriginPersistenceEvidenceError,
  PluginDeliveryOriginPersistenceValidationError,
  PostgresPluginDeliveryOriginGrantStore,
  type PluginDeliveryOriginSqlClient,
  type PluginDeliveryOriginSqlResult,
} from './plugin-delivery-origin-repository';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '..', 'migrations', '0004_plugin_delivery_origin_grant_record.sql'),
  'utf8',
);

const ACTIVE_GRANT: PluginDeliveryOriginGrantRecord = Object.freeze({
  authorityVersion: 'life-os.plugin-delivery-origin.v1',
  grantId: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  grantedByUserId: '44444444-4444-4444-8444-444444444444',
  origin: 'https://api.example.com:8443',
  status: 'active',
  grantedAt: '2026-09-01T20:00:00.000Z',
  revokedAt: null,
});
const CASED_GRANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class ScriptedSqlClient implements PluginDeliveryOriginSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(private readonly results: PluginDeliveryOriginSqlResult<Record<string, unknown>>[]) {}

  async query<Row>(text: string, values: readonly unknown[] = []): Promise<PluginDeliveryOriginSqlResult<Row>> {
    this.calls.push({ text, values });
    const next = this.results.shift();
    if (!next) {
      throw new Error('Unexpected SQL call');
    }
    return next as PluginDeliveryOriginSqlResult<Row>;
  }
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    authority_version: ACTIVE_GRANT.authorityVersion,
    grant_id: ACTIVE_GRANT.grantId,
    installation_id: ACTIVE_GRANT.installationId,
    workspace_id: ACTIVE_GRANT.workspaceId,
    granted_by_user_id: ACTIVE_GRANT.grantedByUserId,
    origin_uri: ACTIVE_GRANT.origin,
    grant_status: ACTIVE_GRANT.status,
    granted_at: new Date(ACTIVE_GRANT.grantedAt),
    revoked_at: null,
    ...overrides,
  };
}

function result(rows: readonly Record<string, unknown>[]): PluginDeliveryOriginSqlResult<Record<string, unknown>> {
  return { rows, rowCount: rows.length };
}

describe('PostgresPluginDeliveryOriginGrantStore', () => {
  it('creates one parameterized durable grant and preserves the versioned authority record', async () => {
    const client = new ScriptedSqlClient([result([row()])]);
    const store = new PostgresPluginDeliveryOriginGrantStore(client);

    await expect(store.createIfAbsent(ACTIVE_GRANT)).resolves.toEqual(ACTIVE_GRANT);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain('INSERT INTO plugin_integration.plugin_delivery_origin_grant_record');
    expect(client.calls[0]?.text).toContain('ON CONFLICT (grant_id) DO NOTHING');
    expect(client.calls[0]?.values).toEqual([
      ACTIVE_GRANT.authorityVersion,
      ACTIVE_GRANT.grantId,
      ACTIVE_GRANT.installationId,
      ACTIVE_GRANT.workspaceId,
      ACTIVE_GRANT.grantedByUserId,
      ACTIVE_GRANT.origin,
      ACTIVE_GRANT.grantedAt,
    ]);
  });

  it('resolves create replay only inside the exact installation, workspace, and user scope', async () => {
    const client = new ScriptedSqlClient([result([]), result([row()])]);
    const store = new PostgresPluginDeliveryOriginGrantStore(client);

    await expect(store.createIfAbsent(ACTIVE_GRANT)).resolves.toEqual(ACTIVE_GRANT);
    expect(client.calls[1]?.text).toContain('installation_id = $2::uuid');
    expect(client.calls[1]?.text).toContain('workspace_id = $3::uuid');
    expect(client.calls[1]?.text).toContain('granted_by_user_id = $4::uuid');
    expect(client.calls[1]?.values).toEqual([
      ACTIVE_GRANT.grantId,
      ACTIVE_GRANT.installationId,
      ACTIVE_GRANT.workspaceId,
      ACTIVE_GRANT.grantedByUserId,
    ]);
  });

  it('atomically revokes an active grant and treats an exact revoked row as replay evidence', async () => {
    const revokedAt = '2026-09-01T21:00:00.000Z';
    const revokedRow = row({ grant_status: 'revoked', revoked_at: new Date(revokedAt) });
    const client = new ScriptedSqlClient([result([]), result([revokedRow])]);
    const store = new PostgresPluginDeliveryOriginGrantStore(client);

    await expect(
      store.revokeActive({
        grantId: ACTIVE_GRANT.grantId,
        installationId: ACTIVE_GRANT.installationId,
        workspaceId: ACTIVE_GRANT.workspaceId,
        grantedByUserId: ACTIVE_GRANT.grantedByUserId,
        revokedAt,
      }),
    ).resolves.toEqual({ ...ACTIVE_GRANT, status: 'revoked', revokedAt });
    expect(client.calls[0]?.text).toContain("grant_status = 'active'");
    expect(client.calls[1]?.text).toContain("grant_status = 'revoked'");
  });

  it('rejects malformed caller input before SQL and corrupted durable evidence after SQL', async () => {
    const validationClient = new ScriptedSqlClient([]);
    const validationStore = new PostgresPluginDeliveryOriginGrantStore(validationClient);
    await expect(
      validationStore.findById('not-a-uuid', ACTIVE_GRANT.installationId, ACTIVE_GRANT.workspaceId, ACTIVE_GRANT.grantedByUserId),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceValidationError);
    expect(validationClient.calls).toHaveLength(0);

    const evidenceClient = new ScriptedSqlClient([result([row({ origin_uri: 'http://downgraded.example.com' })])]);
    const evidenceStore = new PostgresPluginDeliveryOriginGrantStore(evidenceClient);
    await expect(
      evidenceStore.findById(
        ACTIVE_GRANT.grantId,
        ACTIVE_GRANT.installationId,
        ACTIVE_GRANT.workspaceId,
        ACTIVE_GRANT.grantedByUserId,
      ),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceEvidenceError);
  });

  it('rejects non-canonical UUID casing in persisted row evidence', async () => {
    const client = new ScriptedSqlClient([
      result([row({ grant_id: CASED_GRANT_ID.toUpperCase() })]),
    ]);
    const store = new PostgresPluginDeliveryOriginGrantStore(client);

    await expect(
      store.findById(
        CASED_GRANT_ID,
        ACTIVE_GRANT.installationId,
        ACTIVE_GRANT.workspaceId,
        ACTIVE_GRANT.grantedByUserId,
      ),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceEvidenceError);
  });
});

describe('plugin delivery-origin migration contract', () => {
  it('uses descriptive 3NF authority names and database lifecycle constraints without secret material', () => {
    expect(MIGRATION_SQL).toContain('CREATE TABLE plugin_integration.plugin_delivery_origin_grant_record');
    for (const fragment of [
      'authority_version text NOT NULL',
      'grant_id uuid PRIMARY KEY',
      'installation_id uuid NOT NULL',
      'workspace_id uuid NOT NULL',
      'granted_by_user_id uuid NOT NULL',
      'origin_uri text NOT NULL',
      "grant_status text NOT NULL DEFAULT 'active'",
      'granted_at timestamptz NOT NULL',
      'revoked_at timestamptz',
      'plugin_delivery_origin_installation_authority_fk',
      'plugin_delivery_origin_authority_version_check',
      'plugin_delivery_origin_lifecycle_check',
      'plugin_delivery_origin_revocation_time_check',
    ]) {
      expect(MIGRATION_SQL).toContain(fragment);
    }
    expect(MIGRATION_SQL).not.toMatch(/\b(secret|token|password|credential)_/iu);
  });
});
