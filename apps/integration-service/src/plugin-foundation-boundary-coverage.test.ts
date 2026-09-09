import { describe, expect, it } from 'vitest';
import { PLUGIN_CONTRACT_VERSION, type PluginManifest } from '@life-os/plugin-sdk';
import {
  PluginDeliveryAttemptControlApplication,
  type PluginDeliveryAttemptControlStore,
} from './plugin-delivery-attempt-control';
import {
  PluginInstallationApplication,
  PluginInstallationError,
  type PluginInstallationRecord,
  type PluginInstallationStore,
} from './plugin-installation';
import {
  PluginOperatorReplayValidationError,
  PostgresPluginOperatorReplayGuard,
  type PluginOperatorReplaySqlClient,
} from './plugin-operator-replay';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const DELIVERY_ID = '44444444-4444-4444-8444-444444444444';
const EVIDENCE_ID = '55555555-5555-4555-8555-555555555555';
const CAPABILITY = 'lifeos.task.completed.v1';

const MANIFEST: PluginManifest = Object.freeze({
  pluginId: 'com.example.boundary',
  displayName: 'Boundary Fixture',
  contractVersion: PLUGIN_CONTRACT_VERSION,
  subscriptions: Object.freeze([CAPABILITY]),
});

const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});

function installationStore(): PluginInstallationStore {
  return {
    createIfAbsent: async (record: PluginInstallationRecord) => record,
    findById: async () => undefined,
    revokeActive: async () => undefined,
  };
}

describe('Integration foundation remaining boundaries', () => {
  it('uses the production installation clock when no clock is injected', async () => {
    const service = new PluginInstallationApplication(installationStore());

    await expect(
      service.install({
        trustedContext: CONTEXT,
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: [CAPABILITY],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        installationId: INSTALLATION_ID,
        status: 'active',
        installedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/u),
      }),
    );
  });

  it('fails closed when manifest validation rejects the requested manifest', async () => {
    const service = new PluginInstallationApplication(
      installationStore(),
      () => new Date('2026-09-09T00:00:00.000Z'),
    );

    await expect(
      service.install({
        trustedContext: CONTEXT,
        installationId: INSTALLATION_ID,
        manifest: { ...MANIFEST, pluginId: '' },
        grantedCapabilities: [],
      }),
    ).rejects.toBeInstanceOf(PluginInstallationError);
  });

  it('rejects duplicate capability grants before persistence', async () => {
    const service = new PluginInstallationApplication(
      installationStore(),
      () => new Date('2026-09-09T00:00:00.000Z'),
    );

    await expect(
      service.install({
        trustedContext: CONTEXT,
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: [CAPABILITY, CAPABILITY],
      }),
    ).rejects.toBeInstanceOf(PluginInstallationError);
  });

  it('rejects a syntactically shaped but non-canonical replay instant before SQL', async () => {
    let queryCalls = 0;
    const client: PluginOperatorReplaySqlClient = {
      query: async () => {
        queryCalls += 1;
        return { rows: [{ consumed: true }], rowCount: 1 };
      },
    };
    const guard = new PostgresPluginOperatorReplayGuard(client);

    await expect(
      guard.consume({
        evidenceId: EVIDENCE_ID,
        consumedAt: '2026-02-30T00:00:00.000Z',
        expiresAt: '2026-03-03T00:00:00.000Z',
      }),
    ).rejects.toBeInstanceOf(PluginOperatorReplayValidationError);
    expect(queryCalls).toBe(0);
  });

  it('uses the production control clock when no clock is injected', async () => {
    const store: PluginDeliveryAttemptControlStore = {
      pause: async () => undefined,
      resume: async (command) => ({
        authorityVersion: 'life-os.plugin-delivery-attempt-control.v1',
        deliveryId: command.deliveryId,
        workspaceId: command.workspaceId,
        requestedByUserId: command.requestedByUserId,
        controlSequence: 1,
        controlCode: 'resume',
        deliveryStatus: 'pending',
        occurredAt: command.occurredAt,
        nextAttemptAt: command.occurredAt,
        terminalAt: null,
      }),
      deadLetter: async () => undefined,
    };
    const service = new PluginDeliveryAttemptControlApplication(store);

    await expect(service.resume(CONTEXT, DELIVERY_ID)).resolves.toEqual(
      expect.objectContaining({
        deliveryId: DELIVERY_ID,
        controlCode: 'resume',
        deliveryStatus: 'pending',
      }),
    );
  });
});
