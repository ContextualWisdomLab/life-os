import { describe, expect, it } from 'vitest';
import {
  PluginInstallationApplication,
  PluginInstallationError,
  type PluginInstallationRecord,
  type PluginInstallationStore,
  type RevokePluginInstallation,
} from './plugin-installation';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ALPHA = '33333333-3333-4333-8333-333333333333';
const USER_BETA = '44444444-4444-4444-8444-444444444444';
const INSTALLED_AT = '2026-08-10T02:00:00.000Z';
const REVOKED_AT = '2026-08-10T03:00:00.000Z';

function record(
  status: 'active' | 'revoked' = 'active',
): PluginInstallationRecord {
  return Object.freeze({
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ALPHA,
    pluginId: 'example.plugin',
    pluginContractVersion: '1.0.0',
    manifestSha256: 'a'.repeat(64),
    grantedCapabilities: Object.freeze(['lifeos.task.completed.v1']),
    status,
    installedAt: INSTALLED_AT,
    revokedAt: status === 'revoked' ? REVOKED_AT : null,
  });
}

class UserScopeRecordingStore implements PluginInstallationStore {
  readonly lookupArguments: unknown[][] = [];
  readonly revokeArguments: RevokePluginInstallation[] = [];

  async createIfAbsent(
    input: PluginInstallationRecord,
  ): Promise<PluginInstallationRecord> {
    return input;
  }

  async findById(
    installationId: string,
    workspaceId: string,
    installedByUserId?: string,
  ): Promise<PluginInstallationRecord | undefined> {
    this.lookupArguments.push([installationId, workspaceId, installedByUserId]);
    return record();
  }

  async revokeActive(
    input: RevokePluginInstallation,
  ): Promise<PluginInstallationRecord | undefined> {
    this.revokeArguments.push(input);
    return record('revoked');
  }
}

describe('PluginInstallationApplication installer-user authority', () => {
  it('passes the requesting user to persistence and hides another user installation in the same workspace', async () => {
    const store = new UserScopeRecordingStore();
    const application = new PluginInstallationApplication(store);

    await expect(
      application.getInstallation(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_BETA },
        INSTALLATION_ID,
      ),
    ).resolves.toBeUndefined();

    expect(store.lookupArguments).toEqual([
      [INSTALLATION_ID, WORKSPACE_ID, USER_BETA],
    ]);
  });

  it('binds revoke to the requesting user and rejects another user durable result', async () => {
    const store = new UserScopeRecordingStore();
    const application = new PluginInstallationApplication(
      store,
      () => new Date(REVOKED_AT),
    );

    await expect(
      application.revoke(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_BETA },
        INSTALLATION_ID,
      ),
    ).rejects.toBeInstanceOf(PluginInstallationError);

    expect(store.revokeArguments).toEqual([
      {
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_BETA,
        revokedAt: REVOKED_AT,
      },
    ]);
  });
});
