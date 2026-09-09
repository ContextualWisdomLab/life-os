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
const OTHER_INSTALLATION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const INSTALLED_AT = '2026-08-10T02:00:00.000Z';
const REVOKED_AT = '2026-08-10T03:00:00.000Z';

class StaticSqlClient implements PluginInstallationSqlClient {
  constructor(private readonly rows: readonly unknown[]) {}

  async query<Row>(): Promise<PluginInstallationSqlResult<Row>> {
    return {
      rows: this.rows as readonly Row[],
      rowCount: this.rows.length,
    };
  }
}

function candidate(
  overrides: Partial<PluginInstallationRecord> = {},
): PluginInstallationRecord {
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
    ...overrides,
  };
}

function row(overrides: Readonly<Record<string, unknown>> = {}) {
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
  return row({
    installation_status: 'revoked',
    revoked_at: new Date(REVOKED_AT),
    ...overrides,
  });
}

function revokedDateProxy(): Date {
  const { proxy, revoke } = Proxy.revocable(new Date(INSTALLED_AT), {});
  revoke();
  return proxy;
}

async function expectCreateValidationFailure(
  record: PluginInstallationRecord,
): Promise<void> {
  const store = new PostgresPluginInstallationStore(new StaticSqlClient([]));
  await expect(store.createIfAbsent(record)).rejects.toBeInstanceOf(
    PluginInstallationPersistenceValidationError,
  );
}

async function expectReadEvidenceFailure(
  durableRow: Readonly<Record<string, unknown>>,
): Promise<void> {
  const store = new PostgresPluginInstallationStore(
    new StaticSqlClient([durableRow]),
  );
  await expect(
    store.findById(INSTALLATION_ID, WORKSPACE_ID, USER_ID),
  ).rejects.toBeInstanceOf(PluginInstallationPersistenceEvidenceError);
}

describe('PostgresPluginInstallationStore hostile persistence coverage', () => {
  it('normalizes invalid and revoked caller Date objects to the fixed validation error', async () => {
    await expectCreateValidationFailure(
      candidate({ installedAt: new Date(Number.NaN) as unknown as string }),
    );
    await expectCreateValidationFailure(
      candidate({ installedAt: revokedDateProxy() as unknown as string }),
    );
  });

  it('rejects every malformed create boundary before SQL authority', async () => {
    const tooManyCapabilities = Array.from(
      { length: 33 },
      (_, index) => `capability.${String(index).padStart(2, '0')}`,
    );
    const malformed: PluginInstallationRecord[] = [
      candidate({ status: 'revoked', revokedAt: REVOKED_AT }),
      candidate({ revokedAt: REVOKED_AT }),
      candidate({ installationId: 'not-a-uuid' }),
      candidate({ workspaceId: 'not-a-uuid' }),
      candidate({ installedByUserId: 'not-a-uuid' }),
      candidate({ pluginId: '' }),
      candidate({ pluginId: 'x'.repeat(257) }),
      candidate({ pluginId: 'example\u0000plugin' }),
      candidate({ pluginContractVersion: '' }),
      candidate({ pluginContractVersion: 'x'.repeat(129) }),
      candidate({ pluginContractVersion: '1.0\n0' }),
      candidate({ manifestSha256: 'not-a-digest' }),
      candidate({ grantedCapabilities: null as unknown as readonly string[] }),
      candidate({ grantedCapabilities: tooManyCapabilities }),
      candidate({ grantedCapabilities: [''] }),
      candidate({ grantedCapabilities: ['x'.repeat(257)] }),
      candidate({ grantedCapabilities: ['capability\u0000bad'] }),
      candidate({ grantedCapabilities: ['a', 'a'] }),
      candidate({ grantedCapabilities: ['b', 'a'] }),
      candidate({ installedAt: '2026-08-10' }),
      candidate({ installedAt: '2026-02-30T02:00:00.000Z' }),
    ];

    for (const record of malformed) {
      await expectCreateValidationFailure(record);
    }
  });

  it('normalizes malformed persisted instants and lifecycle contradictions to the fixed evidence error', async () => {
    await expectReadEvidenceFailure(
      row({ installed_at: new Date(Number.NaN) }),
    );
    await expectReadEvidenceFailure(row({ installed_at: revokedDateProxy() }));
    await expectReadEvidenceFailure(row({ installed_at: '2026-08-10' }));
    await expectReadEvidenceFailure(
      row({ installed_at: '2026-02-30T02:00:00.000Z' }),
    );
    await expectReadEvidenceFailure(row({ revoked_at: new Date(Number.NaN) }));
    await expectReadEvidenceFailure(row({ revoked_at: '2026-08-10' }));
    await expectReadEvidenceFailure(row({ revoked_at: new Date(REVOKED_AT) }));
    await expectReadEvidenceFailure(
      row({ installation_status: 'revoked', revoked_at: null }),
    );
    await expectReadEvidenceFailure(
      revokedRow({ revoked_at: new Date('2026-08-10T01:59:59.999Z') }),
    );
    await expectReadEvidenceFailure(row({ installation_status: 'unknown' }));
  });

  it('rejects malformed durable identifiers, text, digests, capabilities, and requested-scope mismatches', async () => {
    const tooManyCapabilities = Array.from(
      { length: 33 },
      (_, index) => `capability.${String(index).padStart(2, '0')}`,
    );
    const malformedRows = [
      row({ installation_id: 'not-a-uuid' }),
      row({ workspace_id: 'not-a-uuid' }),
      row({ installed_by_user_id: 'not-a-uuid' }),
      row({ plugin_id: '' }),
      row({ plugin_id: 'x'.repeat(257) }),
      row({ plugin_id: 'example\u0000plugin' }),
      row({ plugin_contract_version: '' }),
      row({ plugin_contract_version: 'x'.repeat(129) }),
      row({ plugin_contract_version: '1.0\n0' }),
      row({ manifest_sha256: 'not-a-digest' }),
      row({ granted_capabilities: null }),
      row({ granted_capabilities: tooManyCapabilities }),
      row({ granted_capabilities: [''] }),
      row({ granted_capabilities: ['x'.repeat(257)] }),
      row({ granted_capabilities: ['capability\u0000bad'] }),
      row({ granted_capabilities: ['a', 'a'] }),
      row({ granted_capabilities: ['b', 'a'] }),
      row({ installation_id: OTHER_INSTALLATION_ID }),
    ];

    for (const durableRow of malformedRows) {
      await expectReadEvidenceFailure(durableRow);
    }
  });

  it('rejects non-exact create winners and malformed revocation winners', async () => {
    const createMismatches = [
      row({ installation_id: OTHER_INSTALLATION_ID }),
      row({ plugin_id: 'other.plugin' }),
      row({ plugin_contract_version: '2.0.0' }),
      row({ manifest_sha256: 'b'.repeat(64) }),
      row({ granted_capabilities: [] }),
      row({ granted_capabilities: ['other.capability'] }),
      revokedRow(),
    ];

    for (const durableRow of createMismatches) {
      const store = new PostgresPluginInstallationStore(
        new StaticSqlClient([durableRow]),
      );
      await expect(store.createIfAbsent(candidate())).rejects.toBeInstanceOf(
        PluginInstallationPersistenceEvidenceError,
      );
    }

    const activeRevocationWinner = new PostgresPluginInstallationStore(
      new StaticSqlClient([row()]),
    );
    await expect(
      activeRevocationWinner.revokeActive({
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        revokedAt: REVOKED_AT,
      }),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceEvidenceError);

    const mismatchedRevocationWinner = new PostgresPluginInstallationStore(
      new StaticSqlClient([
        revokedRow({ installation_id: OTHER_INSTALLATION_ID }),
      ]),
    );
    await expect(
      mismatchedRevocationWinner.revokeActive({
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        revokedAt: REVOKED_AT,
      }),
    ).rejects.toBeInstanceOf(PluginInstallationPersistenceEvidenceError);
  });
});
