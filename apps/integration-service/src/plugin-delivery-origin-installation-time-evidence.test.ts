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

function installation(installedAt: string): PluginInstallationRecord {
  return Object.freeze({
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    pluginId: 'com.example.calendar',
    pluginContractVersion: '1.0.0',
    manifestSha256: 'a'.repeat(64),
    grantedCapabilities: Object.freeze(['calendar.updated']),
    status: 'active',
    installedAt,
    revokedAt: null,
  });
}

function subjectWithInstallation(record: PluginInstallationRecord) {
  const createIfAbsent = vi.fn(
    async (candidate: PluginDeliveryOriginGrantRecord) => candidate,
  );
  return {
    createIfAbsent,
    subject: new PluginDeliveryOriginAuthority(
      {
        createIfAbsent,
        findById: vi.fn(async () => undefined),
        revokeActive: vi.fn(async () => undefined),
      },
      { findById: vi.fn(async () => record) },
      () => NOW,
    ),
  };
}

async function grant(subject: PluginDeliveryOriginAuthority): Promise<unknown> {
  return subject.grant(
    { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
    INSTALLATION_ID,
    { grantId: GRANT_ID, origin: 'https://api.example.com' },
  );
}

describe('Plugin delivery-origin installation time evidence', () => {
  it.each([
    ['malformed installation instant', 'not-an-instant'],
    ['future installation instant', '2026-08-12T06:00:00.001Z'],
  ])('rejects %s before grant persistence', async (_label, installedAt) => {
    const fixture = subjectWithInstallation(installation(installedAt));

    await expect(grant(fixture.subject)).rejects.toBeInstanceOf(
      PluginDeliveryOriginAuthorityError,
    );
    expect(fixture.createIfAbsent).not.toHaveBeenCalled();
  });
});
