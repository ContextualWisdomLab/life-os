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
const NOW = new Date('2026-08-12T06:00:00.000Z');

function installation(
  overrides: Partial<PluginInstallationRecord> = {},
): PluginInstallationRecord {
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
    ...overrides,
  });
}

function authority(existing?: PluginDeliveryOriginGrantRecord) {
  const createIfAbsent = vi.fn(async (candidate: PluginDeliveryOriginGrantRecord) =>
    existing ?? candidate,
  );
  const revokeActive = vi.fn(async () =>
    existing
      ? Object.freeze({
          ...existing,
          status: 'revoked' as const,
          revokedAt: NOW.toISOString(),
        })
      : undefined,
  );
  return {
    createIfAbsent,
    revokeActive,
    subject: new PluginDeliveryOriginAuthority(
      { createIfAbsent, revokeActive },
      () => NOW,
    ),
  };
}

async function expectInvalid(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(
    PluginDeliveryOriginAuthorityError,
  );
}

describe('PluginDeliveryOriginAuthority', () => {
  it('persists only host-owned versioned origin authority for an active installation', async () => {
    const fixture = authority();

    await expect(
      fixture.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        installation(),
        {
          grantId: GRANT_ID,
          origin: 'https://API.Example.com:443',
        },
      ),
    ).resolves.toEqual({
      authorityVersion: 'life-os.plugin-delivery-origin.v1',
      grantId: GRANT_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      grantedByUserId: USER_ID,
      origin: 'https://api.example.com',
      status: 'active',
      grantedAt: NOW.toISOString(),
      revokedAt: null,
    });

    expect(fixture.createIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'https://api.example.com',
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
      }),
    );
  });

  it.each([
    'http://api.example.com',
    'https://user:password@api.example.com',
    'https://api.example.com/path',
    'https://api.example.com/?query=1',
    'https://api.example.com/#fragment',
  ])('rejects non-origin or non-HTTPS authority: %s', async (origin) => {
    const fixture = authority();
    await expectInvalid(
      fixture.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        installation(),
        { grantId: GRANT_ID, origin },
      ),
    );
    expect(fixture.createIfAbsent).not.toHaveBeenCalled();
  });

  it('rejects installation evidence outside the authenticated owner scope', async () => {
    for (const record of [
      installation({ workspaceId: '55555555-5555-4555-8555-555555555555' }),
      installation({ installedByUserId: '66666666-6666-4666-8666-666666666666' }),
      installation({
        status: 'revoked',
        revokedAt: '2026-08-12T05:30:00.000Z',
      }),
    ]) {
      const fixture = authority();
      await expectInvalid(
        fixture.subject.grant(
          { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
          record,
          { grantId: GRANT_ID, origin: 'https://api.example.com' },
        ),
      );
      expect(fixture.createIfAbsent).not.toHaveBeenCalled();
    }
  });

  it('accepts an exact durable replay but rejects conflicting reuse of the same opaque grant identity', async () => {
    const exact: PluginDeliveryOriginGrantRecord = Object.freeze({
      authorityVersion: 'life-os.plugin-delivery-origin.v1',
      grantId: GRANT_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      grantedByUserId: USER_ID,
      origin: 'https://api.example.com',
      status: 'active',
      grantedAt: NOW.toISOString(),
      revokedAt: null,
    });
    await expect(
      authority(exact).subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        installation(),
        { grantId: GRANT_ID, origin: 'https://api.example.com' },
      ),
    ).resolves.toEqual(exact);

    await expectInvalid(
      authority(
        Object.freeze({ ...exact, origin: 'https://other.example.com' }),
      ).subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        installation(),
        { grantId: GRANT_ID, origin: 'https://api.example.com' },
      ),
    );
  });

  it('revokes only an exact workspace/user/installation-owned grant', async () => {
    const active: PluginDeliveryOriginGrantRecord = Object.freeze({
      authorityVersion: 'life-os.plugin-delivery-origin.v1',
      grantId: GRANT_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      grantedByUserId: USER_ID,
      origin: 'https://api.example.com',
      status: 'active',
      grantedAt: NOW.toISOString(),
      revokedAt: null,
    });
    const fixture = authority(active);

    await expect(
      fixture.subject.revoke(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).resolves.toMatchObject({ status: 'revoked', revokedAt: NOW.toISOString() });
    expect(fixture.revokeActive).toHaveBeenCalledWith({
      grantId: GRANT_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      grantedByUserId: USER_ID,
      revokedAt: NOW.toISOString(),
    });
  });
});
