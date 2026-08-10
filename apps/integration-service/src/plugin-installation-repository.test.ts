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
const OTHER_WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555';
const INSTALLED_AT = '2026-08-10T02:00:00.000Z';
const REPLAY_AT = '2026-08-10T02:30:00.000Z';
const REVOKED_AT = '2026-08-10T03:00:00.000Z';

interface SqlCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class RecordingSqlClient implements PluginInstallationSqlClient {
  readonly calls: SqlCall[] = [];

  constructor(private readonly rowsByCall: readonly (readonly unknown[])[]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PluginInstallationSqlResult<Row>> {
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

function revokedRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return activeRow({
    installation_status: 'revoked',
    revoked_at: new Date(REVOKED_AT),
    ...overrides,
  });
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

describe('PostgresPluginInstallationStore', () => {
  it('creates one exact workspace-and-installer-owned installation with parameterized SQL', async () => {
    const client = new RecordingSqlClient([[activeRow()]]);
    const store = new PostgresPluginInstallationStore(client);

    await expect(store.createIfAbsent(candidate())).resolves.toEqual(candidate());
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'INSERT INTO plugin_integration.plugin_installation_record',
    );
    expect(client.calls[0]?.text).toContain(
      'ON CONFLICT (installation_id) DO NOTHING',
    );
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

  it('returns the original durable timestamp after an exact scoped replay', async () => {
    const client = new RecordingSqlClient([[], [activeRow()]]);
    const store = new PostgresPluginInstallationStore(client);

    await expect(store.createIfAbsent(candidate(REPLAY_AT))).resolves.toEqual(
      candidate(),
    );
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.text).toContain(
      'WHERE installation_id = $1::uuid',
    );
    expect(client.calls[1]?.text).toContain('workspace_id = $2::uuid');
    expect(client.calls[1]?.text).toContain('installed_by_user_id = $3::uuid');
    expect(client.calls[1]?.values).toEqual([
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
    ]);
  });

  it('bounds conflict-winner visibility retries instead of fabricating replay success', async () => {
    const eventuallyVisible = new RecordingSqlClient([
      [],
      [],
      [],
      [activeRow()],
    ]);
    const eventualStore = new PostgresPluginInstallationStore(eventuallyVisible);
    await expect(
      eventualStore.createIfAbsent(candidate(REPLAY_AT)),
    ).resolves.toEqual(candidate());
    expect(eventuallyVisible.calls).toHaveLength(4);

    const neverVisible = new RecordingSqlClient([[], [], [], []]);
    const exhaustedStore = new PostgresPluginInstallationStore(neverVisible);
    await expect(
      exhaustedStore.createIfAbsent(candidate(REPLAY_AT)),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceEvidenceError);
    expect(neverVisible.calls).toHaveLength(4);
  });

  it('looks up only exact workspace-and-installer evidence', async () => {
    const matchingClient = new RecordingSqlClient([[activeRow()]]);
    const matchingStore = new PostgresPluginInstallationStore(matchingClient);
    await expect(
      matchingStore.findById(INSTALLATION_ID, WORKSPACE_ID, USER_ID),
    ).resolves.toEqual(candidate());
    expect(matchingClient.calls[0]?.values).toEqual([
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
    ]);
    expect(matchingClient.calls[0]?.text).toContain(
      'installed_by_user_id = $3::uuid',
    );

    const absentClient = new RecordingSqlClient([[]]);
    const absentStore = new PostgresPluginInstallationStore(absentClient);
    await expect(
      absentStore.findById(INSTALLATION_ID, OTHER_WORKSPACE_ID, USER_ID),
    ).resolves.toBeUndefined();
    await expect(
      new PostgresPluginInstallationStore(new RecordingSqlClient([[]])).findById(
        INSTALLATION_ID,
        WORKSPACE_ID,
        OTHER_USER_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it('fails closed when PostgreSQL returns evidence outside the requested authority scope', async () => {
    const workspaceMismatch = new PostgresPluginInstallationStore(
      new RecordingSqlClient([[activeRow({ workspace_id: OTHER_WORKSPACE_ID })]]),
    );
    await expect(
      workspaceMismatch.findById(INSTALLATION_ID, WORKSPACE_ID, USER_ID),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceEvidenceError);

    const userMismatch = new PostgresPluginInstallationStore(
      new RecordingSqlClient([[activeRow({ installed_by_user_id: OTHER_USER_ID })]]),
    );
    await expect(
      userMismatch.findById(INSTALLATION_ID, WORKSPACE_ID, USER_ID),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceEvidenceError);
  });

  it('atomically revokes only installer-owned active authority and replays exact revoked evidence', async () => {
    const activeClient = new RecordingSqlClient([[revokedRow()]]);
    const activeStore = new PostgresPluginInstallationStore(activeClient);
    await expect(
      activeStore.revokeActive({
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        revokedAt: REVOKED_AT,
      }),
    ).resolves.toEqual({
      ...candidate(),
      status: 'revoked',
      revokedAt: REVOKED_AT,
    });
    expect(activeClient.calls[0]?.text).toContain(
      "installation_status = 'active'",
    );
    expect(activeClient.calls[0]?.text).toContain(
      'installed_by_user_id = $3::uuid',
    );
    expect(activeClient.calls[0]?.values).toEqual([
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
      REVOKED_AT,
    ]);

    const replayClient = new RecordingSqlClient([[], [revokedRow()]]);
    const replayStore = new PostgresPluginInstallationStore(replayClient);
    await expect(
      replayStore.revokeActive({
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        revokedAt: REVOKED_AT,
      }),
    ).resolves.toEqual({
      ...candidate(),
      status: 'revoked',
      revokedAt: REVOKED_AT,
    });
    expect(replayClient.calls[1]?.values).toEqual([
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
    ]);

    const missingStore = new PostgresPluginInstallationStore(
      new RecordingSqlClient([[], []]),
    );
    await expect(
      missingStore.revokeActive({
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        revokedAt: REVOKED_AT,
      }),
    ).resolves.toBeUndefined();
  });

  it('fails closed before SQL on malformed authority and rejects duplicate or corrupt durable evidence', async () => {
    const malformedClient = new RecordingSqlClient([]);
    const malformedStore = new PostgresPluginInstallationStore(malformedClient);
    await expect(
      malformedStore.createIfAbsent({
        ...candidate(),
        workspaceId: 'not-a-uuid',
      }),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceValidationError);
    await expect(
      malformedStore.revokeActive({
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: 'not-a-uuid',
        revokedAt: REVOKED_AT,
      }),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceValidationError);
    expect(malformedClient.calls).toHaveLength(0);

    for (const rows of [
      [activeRow(), activeRow()],
      [activeRow({ workspace_id: OTHER_WORKSPACE_ID })],
      [activeRow({ installed_by_user_id: OTHER_USER_ID })],
      [activeRow({ manifest_sha256: 'not-a-digest' })],
    ]) {
      const store = new PostgresPluginInstallationStore(
        new RecordingSqlClient([rows]),
      );
      await expect(store.createIfAbsent(candidate())).rejects.toBeInstanceOf(
        PluginInstallationPersistenceEvidenceError,
      );
    }
  });
});
