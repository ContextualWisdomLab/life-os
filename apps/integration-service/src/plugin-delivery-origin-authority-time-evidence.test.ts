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
const INITIAL_NOW = new Date('2026-08-12T06:00:00.000Z');

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

function durableGrant(grantedAt: string): PluginDeliveryOriginGrantRecord {
  return Object.freeze({
    authorityVersion: 'life-os.plugin-delivery-origin.v1',
    grantId: GRANT_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    grantedByUserId: USER_ID,
    origin: 'https://api.example.com',
    status: 'active',
    grantedAt,
    revokedAt: null,
  });
}

function subjectReturning(
  durable: PluginDeliveryOriginGrantRecord,
  now: Date,
): PluginDeliveryOriginAuthority {
  const store: PluginDeliveryOriginGrantStore = {
    async createIfAbsent(): Promise<PluginDeliveryOriginGrantRecord> {
      return durable;
    },
    async findById(): Promise<PluginDeliveryOriginGrantRecord | undefined> {
      return undefined;
    },
    async revokeActive(): Promise<PluginDeliveryOriginGrantRecord | undefined> {
      return undefined;
    },
  };
  return new PluginDeliveryOriginAuthority(
    store,
    {
      async findById(): Promise<PluginInstallationRecord> {
        return ACTIVE_INSTALLATION;
      },
    },
    () => now,
  );
}

async function grant(
  subject: PluginDeliveryOriginAuthority,
): Promise<PluginDeliveryOriginGrantRecord> {
  return subject.grant(
    { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
    INSTALLATION_ID,
    { grantId: GRANT_ID, origin: 'https://api.example.com' },
  );
}

describe('Plugin delivery-origin create replay time evidence', () => {
  it('rejects a durable winner whose grantedAt is later than the authority instant', async () => {
    const future = durableGrant('2026-08-12T06:00:00.001Z');

    await expect(
      grant(subjectReturning(future, INITIAL_NOW)),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);
  });

  it('accepts an older durable grantedAt when the same grant is replayed later', async () => {
    const original = durableGrant(INITIAL_NOW.toISOString());
    const retryNow = new Date('2026-08-12T06:10:00.000Z');

    await expect(grant(subjectReturning(original, retryNow))).resolves.toEqual(
      original,
    );
  });
});
