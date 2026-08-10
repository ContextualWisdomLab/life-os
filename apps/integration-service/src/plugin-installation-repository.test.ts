import { describe, expect, it } from 'vitest';
import type { PluginInstallationRecord } from './plugin-installation';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const INSTALLED_AT = '2026-08-10T02:00:00.000Z';
const REPLAY_AT = '2026-08-10T02:30:00.000Z';
const REVOKED_AT = '2026-08-10T03:00:00.000Z';

interface SqlCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class RecordingSqlClient {
  readonly calls: SqlCall[] = [];

  constructor(private readonly rowsByCall: readonly (readonly unknown[])[]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }> {
    this.calls.push({ text, values });
    const rows = this.rowsByCall[this.calls.length - 1] ?? [];
    return { rows: rows as readonly Row[], rowCount: rows.length };
  }
}

function activeRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    installed_by_user_id: USER_ID,
    plugin_id: 'example.plugin',
    plugin_contract_version: '1.0.0',
    manifest_sha256: 'a'.repeat(64),
    granted_capabilities: ['task.completed'],
    installation_status: 'active',
    installed_at: new Date(INSTALLED_AT),
    revoked_at: null,
    ...overrides,
  };
}

function candidate(installedAt = INSTALLED_AT): PluginInstallationRecord {
  return {
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    pluginId: 'example.plugin',
    pluginContractVersion: '1.0.0',
    manifestSha256: 'a'.repeat(64),
    grantedCapabilities: ['task.completed'],
    status: 'active',
    installedAt,
    revokedAt: null,
  };
}

async function repositoryModule(): Promise<Readonly<Record<string, unknown>>> {
  return import('./plugin-installation-repository').catch(() => ({}));
}

describe('PostgresPluginInstallationStore', () => {
  it('creates one exact workspace-owned installation with parameterized SQL and no secret columns', async () => {
    const module = await repositoryModule();
    const Store = module.PostgresPluginInstallationStore as new (
      client: RecordingSqlClient,
    ) => { createIfAbsent(record: PluginInstallationRecord): Promise<PluginInstallationRecord> };
    expect(typeof Store).toBe('function');
    const client = new RecordingSqlClient([[activeRow()]]);
    const store = new Store(client);

    await expect(store.createIfAbsent(candidate())).resolves.toEqual(candidate());
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'INSERT INTO plugin_integration.plugin_installation_record',
    );
    expect(client.calls[0]?.text).toContain('ON CONFLICT (installation_id) DO NOTHING');
    expect(client.calls[0]?.text).not.toMatch(/secret|token|credential/iu);
    expect(client.calls[0]?.values).toEqual([
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
      'example.plugin',
      '1.0.0',
      'a'.repeat(64),
      ['task.completed'],
      INSTALLED_AT,
    ]);
  });

  it('returns the original durable timestamp after an exact installation-id replay', async () => {
    const module = await repositoryModule();
    const Store = module.PostgresPluginInstallationStore as new (
      client: RecordingSqlClient,
    ) => { createIfAbsent(record: PluginInstallationRecord): Promise<PluginInstallationRecord> };
    const client = new RecordingSqlClient([[], [activeRow()]]);
    const store = new Store(client);

    await expect(store.createIfAbsent(candidate(REPLAY_AT))).resolves.toEqual(candidate());
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.text).toContain('WHERE installation_id = $1::uuid');
    expect(client.calls[1]?.text).toContain('workspace_id = $2::uuid');
  });

  it('looks up only exact workspace-owned evidence and atomically revokes an active installation', async () => {
    const module = await repositoryModule();
    const Store = module.PostgresPluginInstallationStore as new (
      client: RecordingSqlClient,
    ) => {
      findById(installationId: string): Promise<PluginInstallationRecord | undefined>;
      revokeActive(input: {
        installationId: string;
        workspaceId: string;
        revokedAt: string;
      }): Promise<PluginInstallationRecord | undefined>;
    };
    const client = new RecordingSqlClient([
      [activeRow()],
      [
        activeRow({
          installation_status: 'revoked',
          revoked_at: new Date(REVOKED_AT),
        }),
      ],
    ]);
    const store = new Store(client);

    await expect(store.findById(INSTALLATION_ID)).resolves.toEqual(candidate());
    await expect(
      store.revokeActive({
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        revokedAt: REVOKED_AT,
      }),
    ).resolves.toEqual({ ...candidate(), status: 'revoked', revokedAt: REVOKED_AT });
    expect(client.calls[1]?.text).toContain("installation_status = 'active'");
    expect(client.calls[1]?.text).toContain('workspace_id = $2::uuid');
  });

  it('fails closed before SQL on malformed authority and rejects duplicate or corrupt durable evidence', async () => {
    const module = await repositoryModule();
    const Store = module.PostgresPluginInstallationStore as new (
      client: RecordingSqlClient,
    ) => { createIfAbsent(record: PluginInstallationRecord): Promise<PluginInstallationRecord> };
    const ValidationError = module.PluginInstallationPersistenceValidationError as new () => Error;
    const PersistenceError = module.PluginInstallationPersistenceEvidenceError as new () => Error;
    expect(typeof ValidationError).toBe('function');
    expect(typeof PersistenceError).toBe('function');

    const malformedClient = new RecordingSqlClient([]);
    const malformedStore = new Store(malformedClient);
    await expect(
      malformedStore.createIfAbsent({ ...candidate(), workspaceId: 'not-a-uuid' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(malformedClient.calls).toHaveLength(0);

    for (const rows of [
      [activeRow(), activeRow()],
      [activeRow({ workspace_id: '44444444-4444-4444-8444-444444444444' })],
      [activeRow({ manifest_sha256: 'not-a-digest' })],
    ]) {
      const client = new RecordingSqlClient([rows]);
      const store = new Store(client);
      await expect(store.createIfAbsent(candidate())).rejects.toBeInstanceOf(
        PersistenceError,
      );
    }
  });
});
