import { describe, expect, it, vi } from 'vitest';
import type { PluginInstallationRecord } from './plugin-installation';
import {
  PluginDeliveryOriginAuthority,
  PluginDeliveryOriginAuthorityError,
  type PluginDeliveryOriginGrantRecord,
} from './plugin-delivery-origin-authority';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';

function activeInstallation(): PluginInstallationRecord {
  return Object.freeze({
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
}

function authority() {
  const createIfAbsent = vi.fn(
    async (candidate: PluginDeliveryOriginGrantRecord) => candidate,
  );
  const findInstallationById = vi.fn(async () => activeInstallation());
  return {
    createIfAbsent,
    findInstallationById,
    subject: new PluginDeliveryOriginAuthority(
      {
        createIfAbsent,
        findById: vi.fn(async () => undefined),
        revokeActive: vi.fn(async () => undefined),
      },
      { findById: findInstallationById },
      () => new Date('2026-08-12T06:00:00.000Z'),
    ),
  };
}

describe('PluginDeliveryOriginAuthority direct-IP boundary', () => {
  it.each([
    'https://8.8.8.8',
    'https://127.0.0.1',
    'https://[::1]',
    'https://[::ffff:127.0.0.1]',
  ])('rejects direct IP delivery origins before installation I/O: %s', async (origin) => {
    const fixture = authority();

    await expect(
      fixture.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        { grantId: GRANT_ID, origin },
      ),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);

    expect(fixture.findInstallationById).not.toHaveBeenCalled();
    expect(fixture.createIfAbsent).not.toHaveBeenCalled();
  });
});
