import { describe, expect, it } from 'vitest';
import type { PluginInstallationRecord } from './plugin-installation';
import {
  PluginDeliveryOriginAuthority,
  PluginDeliveryOriginAuthorityError,
  type PluginDeliveryOriginGrantRecord,
  type PluginDeliveryOriginGrantStore,
} from './plugin-delivery-origin-authority';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const CASED_GRANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date('2026-08-12T06:00:00.000Z');

const ACTIVE_INSTALLATION: PluginInstallationRecord = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'com.example.calendar',
  pluginContractVersion: '1.0.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['calendar.updated']),
  status: 'active',
  installedAt: '2026-08-12T05:00:00.000Z',
  revokedAt: null,
});

function storeReturning(
  durableEvidence: unknown,
): PluginDeliveryOriginGrantStore {
  return {
    async createIfAbsent(): Promise<PluginDeliveryOriginGrantRecord> {
      return durableEvidence as PluginDeliveryOriginGrantRecord;
    },
    async findById(): Promise<PluginDeliveryOriginGrantRecord | undefined> {
      return undefined;
    },
    async revokeActive(): Promise<
      PluginDeliveryOriginGrantRecord | undefined
    > {
      return undefined;
    },
  };
}

describe('Plugin delivery-origin durable evidence', () => {
  it.each([undefined, null])(
    'converts malformed create evidence %s into the fixed authority failure',
    async (durableEvidence) => {
      const subject = new PluginDeliveryOriginAuthority(
        storeReturning(durableEvidence),
        {
          async findById(): Promise<PluginInstallationRecord> {
            return ACTIVE_INSTALLATION;
          },
        },
        () => NOW,
      );

      await expect(
        subject.grant(
          { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
          INSTALLATION_ID,
          { grantId: GRANT_ID, origin: 'https://api.example.com' },
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);
    },
  );

  it('rejects non-canonical UUID casing in durable create evidence', async () => {
    const durableEvidence: PluginDeliveryOriginGrantRecord = Object.freeze({
      authorityVersion: 'life-os.plugin-delivery-origin.v1',
      grantId: CASED_GRANT_ID.toUpperCase(),
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      grantedByUserId: USER_ID,
      origin: 'https://api.example.com',
      status: 'active',
      grantedAt: NOW.toISOString(),
      revokedAt: null,
    });
    const subject = new PluginDeliveryOriginAuthority(
      storeReturning(durableEvidence),
      {
        async findById(): Promise<PluginInstallationRecord> {
          return ACTIVE_INSTALLATION;
        },
      },
      () => NOW,
    );

    await expect(
      subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        { grantId: CASED_GRANT_ID, origin: 'https://api.example.com' },
      ),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);
  });
});
