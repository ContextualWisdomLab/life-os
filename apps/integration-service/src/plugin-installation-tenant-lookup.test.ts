import { describe, expect, it } from 'vitest';
import {
  PluginInstallationApplication,
  type PluginInstallationRecord,
  type PluginInstallationStore,
  type RevokePluginInstallation,
} from './plugin-installation';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555';

function installation(
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
    installedAt: '2026-08-10T02:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

class ScopeRecordingStore implements PluginInstallationStore {
  readonly lookupArguments: unknown[][] = [];

  constructor(private readonly lookupResult?: PluginInstallationRecord) {}

  async createIfAbsent(
    record: PluginInstallationRecord,
  ): Promise<PluginInstallationRecord> {
    return record;
  }

  async findById(
    installationId: string,
    workspaceId: string,
    installedByUserId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    this.lookupArguments.push([installationId, workspaceId, installedByUserId]);
    return this.lookupResult;
  }

  async revokeActive(
    _input: RevokePluginInstallation,
  ): Promise<PluginInstallationRecord | undefined> {
    return undefined;
  }
}

describe('PluginInstallationApplication tenant lookup', () => {
  it('returns matching durable evidence and passes both trusted authorities to persistence', async () => {
    const expected = installation();
    const store = new ScopeRecordingStore(expected);
    const application = new PluginInstallationApplication(store);

    await expect(
      application.getInstallation(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
      ),
    ).resolves.toEqual(expected);

    expect(store.lookupArguments).toEqual([
      [INSTALLATION_ID, WORKSPACE_ID, USER_ID],
    ]);
  });

  it('fails closed when a persistence implementation returns another workspace or installer', async () => {
    for (const mismatched of [
      installation({ workspaceId: OTHER_WORKSPACE_ID }),
      installation({ installedByUserId: OTHER_USER_ID }),
    ]) {
      const store = new ScopeRecordingStore(mismatched);
      const application = new PluginInstallationApplication(store);

      await expect(
        application.getInstallation(
          { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
          INSTALLATION_ID,
        ),
      ).resolves.toBeUndefined();
      expect(store.lookupArguments).toEqual([
        [INSTALLATION_ID, WORKSPACE_ID, USER_ID],
      ]);
    }
  });
});
