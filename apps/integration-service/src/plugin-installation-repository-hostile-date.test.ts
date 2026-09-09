import { describe, expect, it } from 'vitest';
import type { PluginInstallationRecord } from './plugin-installation';
import {
  PluginInstallationPersistenceEvidenceError,
  PluginInstallationPersistenceValidationError,
  PostgresPluginInstallationStore,
  type PluginInstallationSqlClient,
  type PluginInstallationSqlResult,
} from './plugin-installation-repository';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const INSTALLED_AT = '2026-08-10T02:00:00.000Z';

class StaticSqlClient implements PluginInstallationSqlClient {
  constructor(private readonly rows: readonly unknown[]) {}

  async query<Row>(): Promise<PluginInstallationSqlResult<Row>> {
    return {
      rows: this.rows as readonly Row[],
      rowCount: this.rows.length,
    };
  }
}

function candidate(): PluginInstallationRecord {
  return {
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    pluginId: 'example.plugin',
    pluginContractVersion: '1.0.0',
    manifestSha256: 'a'.repeat(64),
    grantedCapabilities: ['task.completed'],
    status: 'active',
    installedAt: INSTALLED_AT,
    revokedAt: null,
  };
}

function activeRow(installedAt: unknown) {
  return {
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    installed_by_user_id: USER_ID,
    plugin_id: 'example.plugin',
    plugin_contract_version: '1.0.0',
    manifest_sha256: 'a'.repeat(64),
    granted_capabilities: ['task.completed'],
    installation_status: 'active',
    installed_at: installedAt,
    revoked_at: null,
  };
}

describe('PostgresPluginInstallationStore hostile instant boundary', () => {
  it('normalizes invalid caller Date objects to the fixed validation error', async () => {
    const store = new PostgresPluginInstallationStore(new StaticSqlClient([]));

    await expect(
      store.createIfAbsent({
        ...candidate(),
        installedAt: new Date(Number.NaN) as unknown as string,
      }),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceValidationError);
  });

  it('normalizes invalid persisted Date objects to the fixed evidence error', async () => {
    const store = new PostgresPluginInstallationStore(
      new StaticSqlClient([activeRow(new Date(Number.NaN))]),
    );

    await expect(
      store.findById(INSTALLATION_ID, WORKSPACE_ID, USER_ID),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceEvidenceError);
  });
});
