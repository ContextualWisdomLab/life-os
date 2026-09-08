import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  PluginDeliveryOriginOperatorDependencyError,
  PluginOperatorApplication,
  type PluginInstallationOperatorPort,
} from './plugin-operator-application';
import type {
  GrantPluginDeliveryOriginInput,
  PluginDeliveryOriginGrantRecord,
} from './plugin-delivery-origin-authority';
import type {
  InstallPluginInput,
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';
import type {
  PluginOperatorReplayEvidence,
  PluginOperatorReplayGuardPort,
} from './plugin-operator-replay';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';
const SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_334_400;
const NOW = new Date(NOW_SECONDS * 1_000).toISOString();

const INSTALLATION_RECORD = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'com.example.calendar',
  pluginContractVersion: '1.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['lifeos.calendar.event.v1']),
  status: 'active' as const,
  installedAt: NOW,
  revokedAt: null,
}) satisfies PluginInstallationRecord;

const GRANT_RECORD = Object.freeze({
  authorityVersion: 'life-os.plugin-delivery-origin.v1',
  grantId: GRANT_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  grantedByUserId: USER_ID,
  origin: 'https://calendar.example.com',
  status: 'active' as const,
  grantedAt: NOW,
  revokedAt: null,
}) satisfies PluginDeliveryOriginGrantRecord;

interface DeliveryOriginOperatorPort {
  grant(
    trustedContext: PluginInstallationContext,
    installationId: string,
    input: GrantPluginDeliveryOriginInput,
  ): Promise<PluginDeliveryOriginGrantRecord>;
  getGrant(
    trustedContext: PluginInstallationContext,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined>;
  revoke(
    trustedContext: PluginInstallationContext,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord>;
}

interface DeliveryOriginOperatorApplication {
  grantDeliveryOrigin(
    headers: ReturnType<typeof signedHeaders>,
    installationId: string,
    input: GrantPluginDeliveryOriginInput,
  ): Promise<PluginDeliveryOriginGrantRecord>;
  getDeliveryOrigin(
    headers: ReturnType<typeof signedHeaders>,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined>;
  revokeDeliveryOrigin(
    headers: ReturnType<typeof signedHeaders>,
    installationId: string,
    grantId: string,
  ): Promise<PluginDeliveryOriginGrantRecord>;
}

function signedHeaders(method: 'GET' | 'POST', path: string) {
  const evidenceId = randomUUID();
  const issuedAt = String(NOW_SECONDS);
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    evidenceId,
    issuedAt,
    signature: createHmac('sha256', SECRET)
      .update(
        `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${evidenceId}\n${issuedAt}\n${method}\n${path}`,
        'utf8',
      )
      .digest('base64url'),
  });
}

function installations(): PluginInstallationOperatorPort {
  return {
    async install(_input: InstallPluginInput) {
      return INSTALLATION_RECORD;
    },
    async getInstallation(
      _trustedContext: PluginInstallationContext,
      _installationId: string,
    ) {
      return INSTALLATION_RECORD;
    },
    async revoke(
      _trustedContext: PluginInstallationContext,
      _installationId: string,
    ) {
      return { ...INSTALLATION_RECORD, status: 'revoked', revokedAt: NOW };
    },
  };
}

function replayGuard(): PluginOperatorReplayGuardPort & {
  consume: ReturnType<typeof vi.fn>;
} {
  return {
    consume: vi.fn(async (_evidence: PluginOperatorReplayEvidence) => true),
  };
}

function deliveryOrigins(): DeliveryOriginOperatorPort & {
  grant: ReturnType<typeof vi.fn>;
  getGrant: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
} {
  return {
    grant: vi.fn(async () => GRANT_RECORD),
    getGrant: vi.fn(async () => GRANT_RECORD),
    revoke: vi.fn(async () => ({
      ...GRANT_RECORD,
      status: 'revoked' as const,
      revokedAt: NOW,
    })),
  };
}

function application(
  origins: DeliveryOriginOperatorPort,
  replay: PluginOperatorReplayGuardPort = replayGuard(),
): DeliveryOriginOperatorApplication {
  const Constructor = PluginOperatorApplication as unknown as new (
    installations: PluginInstallationOperatorPort,
    credentials: undefined,
    contextSecret: unknown,
    replayGuard: PluginOperatorReplayGuardPort,
    nowSeconds: () => number,
    deliveryOrigins: DeliveryOriginOperatorPort,
  ) => DeliveryOriginOperatorApplication;
  return new Constructor(
    installations(),
    undefined,
    SECRET,
    replay,
    () => NOW_SECONDS,
    origins,
  );
}

describe('plugin delivery-origin operator authority', () => {
  it('grants an origin only after exact signed one-time route authority', async () => {
    const origins = deliveryOrigins();
    const replay = replayGuard();
    const app = application(origins, replay);
    const path = `/v1/plugins/installations/${INSTALLATION_ID}/delivery-origins`;
    const headers = signedHeaders('POST', path);
    const input = Object.freeze({
      grantId: GRANT_ID,
      origin: 'https://calendar.example.com',
    });

    await expect(
      app.grantDeliveryOrigin(headers, INSTALLATION_ID, input),
    ).resolves.toEqual(GRANT_RECORD);
    expect(replay.consume).toHaveBeenCalledTimes(1);
    expect(origins.grant).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
      INSTALLATION_ID,
      input,
    );
  });

  it('binds delivery-origin reads to the exact dynamic signed path', async () => {
    const origins = deliveryOrigins();
    const app = application(origins);
    const path = `/v1/plugins/installations/${INSTALLATION_ID}/delivery-origins/${GRANT_ID}`;

    await expect(
      app.getDeliveryOrigin(
        signedHeaders('GET', path),
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).resolves.toEqual(GRANT_RECORD);
    expect(origins.getGrant).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
      INSTALLATION_ID,
      GRANT_ID,
    );
  });

  it('revokes an origin only under the exact installation-and-grant signed route', async () => {
    const origins = deliveryOrigins();
    const app = application(origins);
    const path = `/v1/plugins/installations/${INSTALLATION_ID}/delivery-origins/${GRANT_ID}/revoke`;

    await expect(
      app.revokeDeliveryOrigin(
        signedHeaders('POST', path),
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).resolves.toMatchObject({ status: 'revoked', revokedAt: NOW });
    expect(origins.revoke).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
      INSTALLATION_ID,
      GRANT_ID,
    );
  });

  it('does not accept a signature for another operator route as origin authority', async () => {
    const origins = deliveryOrigins();
    const app = application(origins);

    await expect(
      app.grantDeliveryOrigin(
        signedHeaders('POST', '/v1/plugins/credential-bindings'),
        INSTALLATION_ID,
        { grantId: GRANT_ID, origin: 'https://calendar.example.com' },
      ),
    ).rejects.toMatchObject({
      name: 'IntegrationOperatorContextError',
      kind: 'invalid',
    });
    expect(origins.grant).not.toHaveBeenCalled();
  });

  it('consumes valid signed evidence before failing closed on absent origin composition', async () => {
    const replay = replayGuard();
    const app = new PluginOperatorApplication(
      installations(),
      undefined,
      SECRET,
      replay,
      () => NOW_SECONDS,
    );
    const path = `/v1/plugins/installations/${INSTALLATION_ID}/delivery-origins/${GRANT_ID}`;

    await expect(
      app.getDeliveryOrigin(
        signedHeaders('GET', path),
        INSTALLATION_ID,
        GRANT_ID,
      ),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginOperatorDependencyError);
    expect(replay.consume).toHaveBeenCalledTimes(1);
  });
});
