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

class ScopeRecordingStore implements PluginInstallationStore {
  readonly lookupArguments: unknown[][] = [];

  async createIfAbsent(
    record: PluginInstallationRecord,
  ): Promise<PluginInstallationRecord> {
    return record;
  }

  async findById(
    installationId: string,
    workspaceId?: string,
  ): Promise<PluginInstallationRecord | undefined> {
    this.lookupArguments.push([installationId, workspaceId]);
    return undefined;
  }

  async revokeActive(
    _input: RevokePluginInstallation,
  ): Promise<PluginInstallationRecord | undefined> {
    return undefined;
  }
}

describe('PluginInstallationApplication tenant lookup', () => {
  it('passes trusted workspace authority into the persistence lookup instead of widening by installation id', async () => {
    const store = new ScopeRecordingStore();
    const application = new PluginInstallationApplication(store);

    await expect(
      application.getInstallation(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
      ),
    ).resolves.toBeUndefined();

    expect(store.lookupArguments).toEqual([[INSTALLATION_ID, WORKSPACE_ID]]);
  });
});
