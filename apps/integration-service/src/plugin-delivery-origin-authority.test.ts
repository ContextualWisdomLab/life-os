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

function activeGrant(
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

function authority(
  existing?: PluginDeliveryOriginGrantRecord,
  durableInstallation: PluginInstallationRecord | null = installation(),
  now: () => Date = () => NOW,
) {
  const createIfAbsent = vi.fn(
    async (candidate: PluginDeliveryOriginGrantRecord) =>
      existing ?? candidate,
  );
  const findById = vi.fn(async () => existing);
  const revokeActive = vi.fn(async () =>
    existing
      ? Object.freeze({
          ...existing,
          status: 'revoked' as const,
          revokedAt: NOW.toISOString(),
        })
      : undefined,
  );
  const findInstallationById = vi.fn(async () =>
    durableInstallation === null ? undefined : durableInstallation,
  );
  return {
    createIfAbsent,
    findById,
    revokeActive,
    findInstallationById,
    subject: new PluginDeliveryOriginAuthority(
      { createIfAbsent, findById, revokeActive },
      { findById: findInstallationById },
      now,
    ),
  };
}

async function expectInvalid(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(
    PluginDeliveryOriginAuthorityError,
  );
}

describe('PluginDeliveryOriginAuthority', () => {
  it('resolves installation authority from host-owned persistence before granting an origin', async () => {
    const fixture = authority();

    await expect(
      fixture.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        {
          grantId: GRANT_ID,
          origin: 'https://API.Example.com:443',
        },
      ),
    ).resolves.toEqual(activeGrant());

    expect(fixture.findInstallationById).toHaveBeenCalledWith(
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
    );
    expect(fixture.createIfAbsent).toHaveBeenCalledWith(activeGrant());

    const explicitPort = authority();
    await expect(
      explicitPort.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        {
          grantId: GRANT_ID,
          origin: 'https://API.Example.com:8443',
        },
      ),
    ).resolves.toMatchObject({ origin: 'https://api.example.com:8443' });
  });

  it.each([
    'http://api.example.com',
    'https://user:password@api.example.com',
    'https://api.example.com/path',
    'https://api.example.com/?query=1',
    'https://api.example.com/#fragment',
    ' https://api.example.com',
    'https://api.example.com\n',
    'https://api.example.com:0',
    'null',
    `https://${'a'.repeat(505)}`,
  ])(
    'rejects non-origin or non-HTTPS authority before installation I/O: %s',
    async (origin) => {
      const fixture = authority();
      await expectInvalid(
        fixture.subject.grant(
          { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
          INSTALLATION_ID,
          { grantId: GRANT_ID, origin },
        ),
      );
      expect(fixture.findInstallationById).not.toHaveBeenCalled();
      expect(fixture.createIfAbsent).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing installation', null],
    [
      'mismatched installation id',
      installation({
        installationId: '55555555-5555-4555-8555-555555555555',
      }),
    ],
    [
      'mismatched workspace',
      installation({
        workspaceId: '66666666-6666-4666-8666-666666666666',
      }),
    ],
    [
      'mismatched actor',
      installation({
        installedByUserId: '77777777-7777-4777-8777-777777777777',
      }),
    ],
    [
      'revoked installation',
      installation({
        status: 'revoked',
        revokedAt: '2026-08-12T05:30:00.000Z',
      }),
    ],
  ])('rejects %s before persistence', async (_label, record) => {
    const fixture = authority(undefined, record);
    await expectInvalid(
      fixture.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        { grantId: GRANT_ID, origin: 'https://api.example.com' },
      ),
    );
    expect(fixture.createIfAbsent).not.toHaveBeenCalled();
  });

  it('rejects malformed installation and grant identifiers before avoidable I/O', async () => {
    const malformedInstallation = authority();
    await expectInvalid(
      malformedInstallation.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        'not-a-uuid',
        { grantId: GRANT_ID, origin: 'https://api.example.com' },
      ),
    );
    expect(malformedInstallation.findInstallationById).not.toHaveBeenCalled();

    const malformedGrant = authority();
    await expectInvalid(
      malformedGrant.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        { grantId: 'not-a-uuid', origin: 'https://api.example.com' },
      ),
    );
    expect(malformedGrant.findInstallationById).not.toHaveBeenCalled();
    expect(malformedGrant.createIfAbsent).not.toHaveBeenCalled();
  });

  it('fails closed when the authority clock cannot produce an instant', async () => {
    const invalidDate = authority(undefined, installation(), () =>
      new Date(Number.NaN),
    );

    await expectInvalid(
      invalidDate.subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        { grantId: GRANT_ID, origin: 'https://api.example.com' },
      ),
    );
    expect(invalidDate.createIfAbsent).not.toHaveBeenCalled();
  });

  it('accepts an exact durable replay but rejects conflicting opaque grant reuse', async () => {
    await expect(
      authority(activeGrant()).subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        { grantId: GRANT_ID, origin: 'https://api.example.com' },
      ),
    ).resolves.toEqual(activeGrant());

    await expectInvalid(
      authority(
        activeGrant({ origin: 'https://other.example.com' }),
      ).subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        { grantId: GRANT_ID, origin: 'https://api.example.com' },
      ),
    );

    await expectInvalid(
      authority(
        activeGrant({
          status: 'revoked',
          revokedAt: '2026-08-12T06:10:00.000Z',
        }),
      ).subject.grant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        { grantId: GRANT_ID, origin: 'https://api.example.com' },
      ),
    );
  });

  it('reads a grant only through exact workspace, user, installation and grant scope', async () => {
    const fixture = authority(activeGrant());

    await expect(
      fixture.subject.getGrant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).resolves.toEqual(activeGrant());
    expect(fixture.findById).toHaveBeenCalledWith(
      GRANT_ID,
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
    );

    await expect(
      authority(
        activeGrant({
          workspaceId: '88888888-8888-4888-8888-888888888888',
        }),
      ).subject.getGrant(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).resolves.toBeUndefined();
  });

  it('revokes only exact scoped authority and rejects malformed durable outcomes', async () => {
    const fixture = authority(activeGrant());

    await expect(
      fixture.subject.revoke(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).resolves.toMatchObject({
      status: 'revoked',
      revokedAt: NOW.toISOString(),
    });
    expect(fixture.revokeActive).toHaveBeenCalledWith({
      grantId: GRANT_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      grantedByUserId: USER_ID,
      revokedAt: NOW.toISOString(),
    });

    await expectInvalid(
      authority(
        activeGrant({
          installationId: '99999999-9999-4999-8999-999999999999',
        }),
      ).subject.revoke(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        GRANT_ID,
      ),
    );

    await expectInvalid(
      authority().subject.revoke(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        INSTALLATION_ID,
        GRANT_ID,
      ),
    );
  });
});
