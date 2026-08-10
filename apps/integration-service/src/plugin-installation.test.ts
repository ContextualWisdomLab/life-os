import { describe, expect, it } from 'vitest';
import {
  PluginInstallationApplication,
  PluginInstallationError,
  type PluginInstallationRecord,
  type PluginInstallationStore,
} from './plugin-installation';
import { PLUGIN_CONTRACT_VERSION, type PluginManifest } from '@life-os/plugin-sdk';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ALPHA = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_BETA = '33333333-3333-4333-8333-333333333333';
const USER_ALPHA = '44444444-4444-4444-8444-444444444444';
const USER_BETA = '55555555-5555-4555-8555-555555555555';
const FIXED_TIME = new Date('2026-08-10T01:00:00.000Z');
const TASK_COMPLETED = 'lifeos.task.completed.v1';
const HABIT_COMPLETED = 'lifeos.habit.completed.v1';

const MANIFEST: PluginManifest = Object.freeze({
  pluginId: 'com.example.lifeos-audit',
  displayName: 'LifeOS Audit Sink',
  contractVersion: PLUGIN_CONTRACT_VERSION,
  subscriptions: Object.freeze([TASK_COMPLETED, HABIT_COMPLETED]),
});

class MemoryInstallationStore implements PluginInstallationStore {
  readonly records = new Map<string, PluginInstallationRecord>();
  saveCalls = 0;

  async findById(
    installationId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    return this.records.get(installationId);
  }

  async save(record: PluginInstallationRecord): Promise<void> {
    this.saveCalls += 1;
    this.records.set(record.installationId, record);
  }
}

class CoordinatedInstallationStore extends MemoryInstallationStore {
  private absentReads = 0;
  private releaseAbsentReads: (() => void) | undefined;
  private readonly absentReadBarrier = new Promise<void>((resolve) => {
    this.releaseAbsentReads = resolve;
  });

  override async findById(
    installationId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    const existing = this.records.get(installationId);
    if (existing) {
      return existing;
    }
    this.absentReads += 1;
    if (this.absentReads === 2) {
      this.releaseAbsentReads?.();
    }
    await this.absentReadBarrier;
    return existing;
  }
}

function application(store = new MemoryInstallationStore()): {
  readonly service: PluginInstallationApplication;
  readonly store: MemoryInstallationStore;
} {
  return {
    service: new PluginInstallationApplication(store, () => FIXED_TIME),
    store,
  };
}

describe('PluginInstallationApplication', () => {
  it('persists only the explicitly granted subset of manifest subscriptions', async () => {
    const { service, store } = application();

    const installed = await service.install({
      trustedContext: {
        workspaceId: WORKSPACE_ALPHA,
        actorUserId: USER_ALPHA,
      },
      installationId: INSTALLATION_ID,
      manifest: MANIFEST,
      grantedCapabilities: [TASK_COMPLETED],
    });

    expect(installed).toEqual({
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ALPHA,
      installedByUserId: USER_ALPHA,
      pluginId: MANIFEST.pluginId,
      pluginContractVersion: PLUGIN_CONTRACT_VERSION,
      manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      grantedCapabilities: [TASK_COMPLETED],
      status: 'active',
      installedAt: FIXED_TIME.toISOString(),
      revokedAt: null,
    });
    expect(store.records.get(INSTALLATION_ID)).toEqual(installed);
    expect(Object.isFrozen(installed)).toBe(true);
    expect(Object.isFrozen(installed.grantedCapabilities)).toBe(true);
  });

  it('rejects a manifest subscription that the trusted installer did not explicitly grant', async () => {
    const { service } = application();

    const installed = await service.install({
      trustedContext: {
        workspaceId: WORKSPACE_ALPHA,
        actorUserId: USER_ALPHA,
      },
      installationId: INSTALLATION_ID,
      manifest: MANIFEST,
      grantedCapabilities: [TASK_COMPLETED],
    });

    expect(installed.grantedCapabilities).not.toContain(HABIT_COMPLETED);
  });

  it('rejects grants that are absent from the validated manifest', async () => {
    const { service } = application();

    await expect(
      service.install({
        trustedContext: {
          workspaceId: WORKSPACE_ALPHA,
          actorUserId: USER_ALPHA,
        },
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: ['lifeos.project.deleted.v1'],
      }),
    ).rejects.toBeInstanceOf(PluginInstallationError);
  });

  it('replays an identical installation idempotently and rejects conflicting reuse', async () => {
    const { service, store } = application();
    const input = {
      trustedContext: {
        workspaceId: WORKSPACE_ALPHA,
        actorUserId: USER_ALPHA,
      },
      installationId: INSTALLATION_ID,
      manifest: MANIFEST,
      grantedCapabilities: [TASK_COMPLETED],
    } as const;

    const first = await service.install(input);
    const replay = await service.install(input);

    expect(replay).toEqual(first);
    expect(store.saveCalls).toBe(1);

    await expect(
      service.install({
        ...input,
        grantedCapabilities: [HABIT_COMPLETED],
      }),
    ).rejects.toBeInstanceOf(PluginInstallationError);
    expect(store.saveCalls).toBe(1);
  });

  it('rejects a conflicting concurrent installation identity instead of last-write-wins', async () => {
    const store = new CoordinatedInstallationStore();
    const service = new PluginInstallationApplication(store, () => FIXED_TIME);
    const trustedContext = {
      workspaceId: WORKSPACE_ALPHA,
      actorUserId: USER_ALPHA,
    } as const;

    const outcomes = await Promise.allSettled([
      service.install({
        trustedContext,
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: [TASK_COMPLETED],
      }),
      service.install({
        trustedContext,
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: [HABIT_COMPLETED],
      }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    expect(store.saveCalls).toBe(1);
    expect(store.records.get(INSTALLATION_ID)?.grantedCapabilities).toHaveLength(1);
  });

  it('hides an installation from a different workspace and user authority', async () => {
    const { service } = application();
    await service.install({
      trustedContext: {
        workspaceId: WORKSPACE_ALPHA,
        actorUserId: USER_ALPHA,
      },
      installationId: INSTALLATION_ID,
      manifest: MANIFEST,
      grantedCapabilities: [TASK_COMPLETED],
    });

    await expect(
      service.getInstallation(
        { workspaceId: WORKSPACE_BETA, actorUserId: USER_BETA },
        INSTALLATION_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it('revokes future use while preserving immutable installation evidence', async () => {
    const { service, store } = application();
    const installed = await service.install({
      trustedContext: {
        workspaceId: WORKSPACE_ALPHA,
        actorUserId: USER_ALPHA,
      },
      installationId: INSTALLATION_ID,
      manifest: MANIFEST,
      grantedCapabilities: [TASK_COMPLETED],
    });

    const revoked = await service.revoke(
      { workspaceId: WORKSPACE_ALPHA, actorUserId: USER_ALPHA },
      INSTALLATION_ID,
    );

    expect(revoked).toEqual({
      ...installed,
      status: 'revoked',
      revokedAt: FIXED_TIME.toISOString(),
    });
    expect(store.records.get(INSTALLATION_ID)).toEqual(revoked);
  });

  it('fails closed on malformed UUIDv4 authority inputs', async () => {
    const { service } = application();

    await expect(
      service.install({
        trustedContext: {
          workspaceId: 'not-a-workspace',
          actorUserId: USER_ALPHA,
        },
        installationId: INSTALLATION_ID,
        manifest: MANIFEST,
        grantedCapabilities: [TASK_COMPLETED],
      }),
    ).rejects.toBeInstanceOf(PluginInstallationError);
  });
});
