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
const NOW = new Date('2026-08-12T06:00:00.000Z');

const ACTIVE_GRANT: PluginDeliveryOriginGrantRecord = Object.freeze({
  authorityVersion: 'life-os.plugin-delivery-origin.v1',
  grantId: GRANT_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  grantedByUserId: USER_ID,
  origin: 'https://api.example.com',
  status: 'active',
  grantedAt: '2026-08-12T05:30:00.000Z',
  revokedAt: null,
});

const REVOKED_INSTALLATION: PluginInstallationRecord = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'com.example.calendar',
  pluginContractVersion: '1.0.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['calendar.updated']),
  status: 'revoked',
  installedAt: '2026-08-12T05:00:00.000Z',
  revokedAt: '2026-08-12T05:45:00.000Z',
});

describe('Plugin delivery-origin installation revocation evidence', () => {
  it('does not expose an active origin grant after its installation is revoked', async () => {
    const findInstallationById = vi.fn(
      async (): Promise<PluginInstallationRecord> => REVOKED_INSTALLATION,
    );
    const store: PluginDeliveryOriginGrantStore = {
      async createIfAbsent(
        candidate: PluginDeliveryOriginGrantRecord,
      ): Promise<PluginDeliveryOriginGrantRecord> {
        return candidate;
      },
      async findById(): Promise<PluginDeliveryOriginGrantRecord> {
        return ACTIVE_GRANT;
      },
      async revokeActive(): Promise<PluginDeliveryOriginGrantRecord | undefined> {
        return undefined;
      },
    };
    const subject = new PluginDeliveryOriginAuthority(
      store,
      { findById: findInstallationById },
      () => NOW,
    );

    await expect(
      subject.getGrant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);

    expect(findInstallationById).toHaveBeenCalledWith(
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
    );
  });
});
