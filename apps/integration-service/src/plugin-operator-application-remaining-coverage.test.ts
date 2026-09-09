import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  InstallPluginInput,
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';
import {
  PluginOperatorApplication,
  type PluginInstallationOperatorPort,
} from './plugin-operator-application';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const EVIDENCE_ID = '44444444-4444-4444-8444-444444444444';
const SECRET = 'operator-context-secret-material-32-bytes';
const PATH = `/v1/plugins/installations/${INSTALLATION_ID}`;

const INSTALLATION_RECORD: PluginInstallationRecord = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'com.example.coverage',
  pluginContractVersion: '1.0.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['lifeos.coverage.read.v1']),
  status: 'active',
  installedAt: '2026-09-09T00:00:00.000Z',
  revokedAt: null,
});

function signedHeaders(nowSeconds: number) {
  const issuedAt = String(nowSeconds);
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    evidenceId: EVIDENCE_ID,
    issuedAt,
    signature: createHmac('sha256', SECRET)
      .update(
        `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${EVIDENCE_ID}\n${issuedAt}\nGET\n${PATH}`,
        'utf8',
      )
      .digest('base64url'),
  });
}

function installationPort(): PluginInstallationOperatorPort & {
  readonly getInstallation: ReturnType<typeof vi.fn>;
} {
  return {
    install: vi.fn(async (_input: InstallPluginInput) => INSTALLATION_RECORD),
    getInstallation: vi.fn(
      async (_context: PluginInstallationContext, _installationId: string) =>
        INSTALLATION_RECORD,
    ),
    revoke: vi.fn(
      async (_context: PluginInstallationContext, _installationId: string) =>
        INSTALLATION_RECORD,
    ),
  };
}

function replayGuard(): PluginOperatorReplayGuardPort & {
  readonly consume: ReturnType<typeof vi.fn>;
} {
  return { consume: vi.fn(async () => true) };
}

describe('PluginOperatorApplication remaining clock boundaries', () => {
  it('uses the production Unix-second clock when no clock is injected', async () => {
    const installations = installationPort();
    const replay = replayGuard();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const app = new PluginOperatorApplication(
      installations,
      undefined,
      SECRET,
      replay,
    );

    await expect(
      app.getInstallation(signedHeaders(nowSeconds), INSTALLATION_ID),
    ).resolves.toEqual(INSTALLATION_RECORD);
    expect(installations.getInstallation).toHaveBeenCalledTimes(1);
    expect(replay.consume).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a verified Unix second is outside the Date persistence range', async () => {
    const installations = installationPort();
    const replay = replayGuard();
    const outOfDateRangeSeconds = 9_000_000_000_000;
    const app = new PluginOperatorApplication(
      installations,
      undefined,
      SECRET,
      replay,
      () => outOfDateRangeSeconds,
    );

    await expect(
      app.getInstallation(
        signedHeaders(outOfDateRangeSeconds),
        INSTALLATION_ID,
      ),
    ).rejects.toMatchObject({
      name: 'IntegrationOperatorContextError',
      kind: 'unavailable',
    });
    expect(replay.consume).not.toHaveBeenCalled();
    expect(installations.getInstallation).not.toHaveBeenCalled();
  });
});
