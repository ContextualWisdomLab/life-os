import { describe, expect, it } from 'vitest';
import {
  PluginInstallationApplication,
  type PluginInstallationRecord,
  type PluginInstallationStore,
  type RevokePluginInstallation,
} from './plugin-installation';

const REQUESTED_INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const CORRUPTED_INSTALLATION_ID = '66666666-6666-4666-8666-666666666666';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

const MISMATCHED_RECORD: PluginInstallationRecord = Object.freeze({
  installationId: CORRUPTED_INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'com.example.identity-sink',
  pluginContractVersion: '1.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['lifeos.task.completed.v1']),
  status: 'active',
  installedAt: '2026-08-10T09:00:00.000Z',
  revokedAt: null,
});

class MismatchedLookupStore implements PluginInstallationStore {
  async createIfAbsent(
    record: PluginInstallationRecord,
  ): Promise<PluginInstallationRecord> {
    return record;
  }

  async findById(): Promise<PluginInstallationRecord | undefined> {
    return MISMATCHED_RECORD;
  }

  async revokeActive(
    _input: RevokePluginInstallation,
  ): Promise<PluginInstallationRecord | undefined> {
    return undefined;
  }
}

describe('Plugin installation lookup evidence identity', () => {
  it('does not expose a persistence row whose installation identity differs from the requested locator', async () => {
    const application = new PluginInstallationApplication(
      new MismatchedLookupStore(),
    );

    await expect(
      application.getInstallation(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        REQUESTED_INSTALLATION_ID,
      ),
    ).resolves.toBeUndefined();
  });
});
