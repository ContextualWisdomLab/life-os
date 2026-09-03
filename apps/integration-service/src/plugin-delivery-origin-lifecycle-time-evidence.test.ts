import { describe, expect, it, vi } from 'vitest';
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
const INSTALLED_AT = '2026-08-12T05:00:00.000Z';
const NOW = new Date('2026-08-12T06:00:00.000Z');

const INSTALLATION: PluginInstallationRecord = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'com.example.calendar',
  pluginContractVersion: '1.0.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['calendar.updated']),
  status: 'active',
  installedAt: INSTALLED_AT,
  revokedAt: null,
});

function record(
  overrides: Partial<PluginDeliveryOriginGrantRecord> = {},
): PluginDeliveryOriginGrantRecord {
  return Object.freeze({
    authorityVersion: 'life-os.plugin-delivery-origin.v1',
    grantId: GRANT_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    grantedByUserId: USER_ID,
    origin: 'https://api.example.com',
    status: 'active',
    grantedAt: NOW.toISOString(),
    revokedAt: null,
    ...overrides,
  });
}

function authority(store: PluginDeliveryOriginGrantStore, now = NOW) {
  return new PluginDeliveryOriginAuthority(
    store,
    { findById: vi.fn(async () => INSTALLATION) },
    () => now,
  );
}

function storeWith(
  createWinner: PluginDeliveryOriginGrantRecord = record(),
  revokeWinner: PluginDeliveryOriginGrantRecord | undefined = undefined,
): PluginDeliveryOriginGrantStore {
  return {
    createIfAbsent: vi.fn(async () => createWinner),
    findById: vi.fn(async () => undefined),
    revokeActive: vi.fn(async () => revokeWinner),
  };
}

const CONTEXT = { workspaceId: WORKSPACE_ID, actorUserId: USER_ID } as const;

describe('Plugin delivery-origin lifecycle time evidence', () => {
  it('rejects a durable grant that predates its installation', async () => {
    const durable = record({ grantedAt: '2026-08-12T04:59:59.999Z' });

    await expect(
      authority(storeWith(durable)).grant(CONTEXT, INSTALLATION_ID, {
        grantId: GRANT_ID,
        origin: 'https://api.example.com',
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);
  });

  it('rejects a revocation winner later than the requested revocation instant', async () => {
    const futureRevocation = record({
      status: 'revoked',
      revokedAt: '2026-08-12T06:00:00.001Z',
    });

    await expect(
      authority(storeWith(record(), futureRevocation)).revoke(
        CONTEXT,
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);
  });

  it('accepts an older durable revocation on a later idempotent retry', async () => {
    const originalRevocation = record({
      status: 'revoked',
      revokedAt: NOW.toISOString(),
    });
    const retryNow = new Date('2026-08-12T06:10:00.000Z');

    await expect(
      authority(storeWith(record(), originalRevocation), retryNow).revoke(
        CONTEXT,
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).resolves.toEqual(originalRevocation);
  });
});
