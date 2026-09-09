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
const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});

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

function storeWith(
  existing: PluginDeliveryOriginGrantRecord | undefined,
): PluginDeliveryOriginGrantStore {
  return {
    createIfAbsent: async (record) => existing ?? record,
    findById: async () => existing,
    revokeActive: async () => undefined,
  };
}

async function expectInvalid(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(
    PluginDeliveryOriginAuthorityError,
  );
}

describe('Plugin delivery-origin remaining authority branches', () => {
  it('rejects a syntactically shaped but impossible durable instant', async () => {
    const subject = new PluginDeliveryOriginAuthority(
      storeWith(
        activeGrant({
          grantedAt: '2026-02-30T00:00:00.000Z',
        }),
      ),
      { findById: async () => installation() },
      () => NOW,
    );

    await expectInvalid(
      subject.getGrant(CONTEXT, INSTALLATION_ID, GRANT_ID),
    );
  });

  it('fails closed when URL parsing rejects an authority-shaped origin', async () => {
    const findInstallationById = vi.fn(async () => installation());
    const subject = new PluginDeliveryOriginAuthority(
      storeWith(undefined),
      { findById: findInstallationById },
      () => NOW,
    );

    await expectInvalid(
      subject.grant(CONTEXT, INSTALLATION_ID, {
        grantId: GRANT_ID,
        origin: 'https://api.example.com:99999',
      }),
    );
    expect(findInstallationById).not.toHaveBeenCalled();
  });

  it('rejects a durable status outside the authority lifecycle', async () => {
    const malformed = {
      ...activeGrant(),
      status: 'paused',
    } as unknown as PluginDeliveryOriginGrantRecord;
    const subject = new PluginDeliveryOriginAuthority(
      storeWith(malformed),
      { findById: async () => installation() },
      () => NOW,
    );

    await expectInvalid(
      subject.getGrant(CONTEXT, INSTALLATION_ID, GRANT_ID),
    );
  });

  it('returns no authority when the exact scoped grant is absent', async () => {
    const findInstallationById = vi.fn(async () => installation());
    const subject = new PluginDeliveryOriginAuthority(
      storeWith(undefined),
      { findById: findInstallationById },
      () => NOW,
    );

    await expect(
      subject.getGrant(CONTEXT, INSTALLATION_ID, GRANT_ID),
    ).resolves.toBeUndefined();
    expect(findInstallationById).not.toHaveBeenCalled();
  });

  it('rejects a revoked grant whose revocation is later than the trusted read instant', async () => {
    const subject = new PluginDeliveryOriginAuthority(
      storeWith(
        activeGrant({
          status: 'revoked',
          revokedAt: '2026-08-12T06:00:01.000Z',
        }),
      ),
      { findById: async () => installation() },
      () => NOW,
    );

    await expectInvalid(
      subject.getGrant(CONTEXT, INSTALLATION_ID, GRANT_ID),
    );
  });

  it('rejects an active grant after current installation authority disappears', async () => {
    const subject = new PluginDeliveryOriginAuthority(
      storeWith(activeGrant()),
      { findById: async () => undefined },
      () => NOW,
    );

    await expectInvalid(
      subject.getGrant(CONTEXT, INSTALLATION_ID, GRANT_ID),
    );
  });

  it('rejects an active grant that predates the current installation lifecycle', async () => {
    const subject = new PluginDeliveryOriginAuthority(
      storeWith(activeGrant()),
      {
        findById: async () =>
          installation({ installedAt: '2026-08-12T06:30:00.000Z' }),
      },
      () => new Date('2026-08-12T07:00:00.000Z'),
    );

    await expectInvalid(
      subject.getGrant(CONTEXT, INSTALLATION_ID, GRANT_ID),
    );
  });

  it('uses the production clock when no delivery-origin clock is injected', async () => {
    const subject = new PluginDeliveryOriginAuthority(
      storeWith(undefined),
      {
        findById: async () =>
          installation({ installedAt: '2020-01-01T00:00:00.000Z' }),
      },
    );

    const granted = await subject.grant(CONTEXT, INSTALLATION_ID, {
      grantId: GRANT_ID,
      origin: 'https://api.example.com',
    });

    expect(Number.isFinite(Date.parse(granted.grantedAt))).toBe(true);
    expect(new Date(granted.grantedAt).toISOString()).toBe(granted.grantedAt);
  });
});
