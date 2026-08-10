import { describe, expect, it } from 'vitest';
import {
  PluginInstallationApplication,
  PluginInstallationError,
  type PluginInstallationRecord,
  type PluginInstallationStore,
  type RevokePluginInstallation,
} from './plugin-installation';
import {
  PLUGIN_CONTRACT_VERSION,
  type PluginManifest,
} from '@life-os/plugin-sdk';

const REQUESTED_INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const CORRUPTED_INSTALLATION_ID = '66666666-6666-4666-8666-666666666666';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CAPABILITY = 'lifeos.task.completed.v1';
const FIXED_TIME = new Date('2026-08-10T09:00:00.000Z');

const MANIFEST: PluginManifest = Object.freeze({
  pluginId: 'com.example.identity-sink',
  displayName: 'Identity Sink',
  contractVersion: PLUGIN_CONTRACT_VERSION,
  subscriptions: Object.freeze([CAPABILITY]),
});

class MismatchedIdentityStore implements PluginInstallationStore {
  async createIfAbsent(
    record: PluginInstallationRecord,
  ): Promise<PluginInstallationRecord> {
    return Object.freeze({
      ...record,
      installationId: CORRUPTED_INSTALLATION_ID,
    });
  }

  async findById(): Promise<PluginInstallationRecord | undefined> {
    return undefined;
  }

  async revokeActive(
    _input: RevokePluginInstallation,
  ): Promise<PluginInstallationRecord | undefined> {
    return undefined;
  }
}

describe('Plugin installation durable evidence identity', () => {
  it('rejects a persistence winner whose opaque installation identity differs from the request', async () => {
    const application = new PluginInstallationApplication(
      new MismatchedIdentityStore(),
      () => FIXED_TIME,
    );

    await expect(
      application.install({
        trustedContext: {
          workspaceId: WORKSPACE_ID,
          actorUserId: USER_ID,
        },
        installationId: REQUESTED_INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: [CAPABILITY],
      }),
    ).rejects.toBeInstanceOf(PluginInstallationError);
  });
});
