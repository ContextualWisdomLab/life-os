import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PluginManifest } from '@life-os/plugin-sdk';
import {
  PluginOperatorApplication,
  PluginOperatorDependencyError,
  type PluginCredentialOperatorPort,
  type PluginInstallationOperatorPort,
} from './plugin-operator-application';
import type {
  PluginCredentialBindingView,
  BindPluginCredentialInput,
} from './plugin-credential';
import type {
  InstallPluginInput,
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const CREDENTIAL_BINDING_ID = '44444444-4444-4444-8444-444444444444';
const SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_334_400;
const NOW = new Date(NOW_SECONDS * 1_000).toISOString();

const MANIFEST: PluginManifest = Object.freeze({
  pluginId: 'com.example.calendar',
  displayName: 'Example Calendar',
  contractVersion: '1.0',
  subscriptions: Object.freeze(['lifeos.calendar.event.v1']),
});

const INSTALLATION_RECORD: PluginInstallationRecord = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: MANIFEST.pluginId,
  pluginContractVersion: MANIFEST.contractVersion,
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['lifeos.calendar.event.v1']),
  status: 'active',
  installedAt: NOW,
  revokedAt: null,
});

const CREDENTIAL_VIEW: PluginCredentialBindingView = Object.freeze({
  credentialBindingId: CREDENTIAL_BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'oauth.access-token',
  status: 'active',
  boundAt: NOW,
  revokedAt: null,
});

function signedHeaders(
  method: 'GET' | 'POST',
  path: string,
  issuedAt = String(NOW_SECONDS),
): {
  readonly workspaceId: string;
  readonly userId: string;
  readonly issuedAt: string;
  readonly signature: string;
} {
  return {
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    issuedAt,
    signature: createHmac('sha256', SECRET)
      .update(
        `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${issuedAt}\n${method}\n${path}`,
        'utf8',
      )
      .digest('base64url'),
  };
}

function installationPort(): PluginInstallationOperatorPort & {
  install: ReturnType<typeof vi.fn>;
  getInstallation: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
} {
  return {
    install: vi.fn(async (_input: InstallPluginInput) => INSTALLATION_RECORD),
    getInstallation: vi.fn(
      async (_context: PluginInstallationContext, _installationId: string) =>
        INSTALLATION_RECORD,
    ),
    revoke: vi.fn(
      async (_context: PluginInstallationContext, _installationId: string) =>
        ({
          ...INSTALLATION_RECORD,
          status: 'revoked' as const,
          revokedAt: NOW,
        }),
    ),
  };
}

function credentialPort(): PluginCredentialOperatorPort & {
  bind: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
} {
  return {
    bind: vi.fn(async (_input: BindPluginCredentialInput) => CREDENTIAL_VIEW),
    revoke: vi.fn(
      async (_context: PluginInstallationContext, _credentialBindingId: string) =>
        ({ ...CREDENTIAL_VIEW, status: 'revoked' as const, revokedAt: NOW }),
    ),
  };
}

function application(
  installations = installationPort(),
  credentials: PluginCredentialOperatorPort | undefined = credentialPort(),
): PluginOperatorApplication {
  return new PluginOperatorApplication(
    installations,
    credentials,
    SECRET,
    () => NOW_SECONDS,
  );
}

describe('authenticated plugin operator composition', () => {
  it('forwards installation input only with cryptographically derived tenant/user authority', async () => {
    const installations = installationPort();
    const app = application(installations);
    const input = {
      installationId: INSTALLATION_ID,
      manifest: MANIFEST,
      grantedCapabilities: ['lifeos.calendar.event.v1'],
    } as const;

    const result = await app.install(
      signedHeaders('POST', '/v1/plugins/installations'),
      input,
    );

    expect(result).toEqual(INSTALLATION_RECORD);
    expect(installations.install).toHaveBeenCalledWith({
      ...input,
      trustedContext: {
        workspaceId: WORKSPACE_ID,
        actorUserId: USER_ID,
      },
    });
  });

  it('rejects replaying a read signature as revocation before application authority', async () => {
    const installations = installationPort();
    const app = application(installations);
    const readPath = `/v1/plugins/installations/${INSTALLATION_ID}`;

    await expect(
      app.revokeInstallation(
        signedHeaders('GET', readPath),
        INSTALLATION_ID,
      ),
    ).rejects.toMatchObject({
      name: 'IntegrationOperatorContextError',
      kind: 'invalid',
    });
    expect(installations.revoke).not.toHaveBeenCalled();
  });

  it('rejects ambiguous dynamic identifiers before installation lookup', async () => {
    const installations = installationPort();
    const app = application(installations);
    const ambiguousId = `${INSTALLATION_ID}?workspace=${WORKSPACE_ID}`;

    await expect(
      app.getInstallation(
        signedHeaders(
          'GET',
          `/v1/plugins/installations/${INSTALLATION_ID}`,
        ),
        ambiguousId,
      ),
    ).rejects.toMatchObject({
      kind: 'invalid',
    });
    expect(installations.getInstallation).not.toHaveBeenCalled();
  });

  it('keeps missing secret-store composition explicitly unavailable after valid authentication', async () => {
    const installations = installationPort();
    const app = application(installations, undefined);
    const input = {
      credentialBindingId: CREDENTIAL_BINDING_ID,
      installationId: INSTALLATION_ID,
      credentialName: 'oauth.access-token',
      secretValue: 'provider-token-value',
    } as const;

    await expect(
      app.bindCredential(
        signedHeaders('POST', '/v1/plugins/credential-bindings'),
        input,
      ),
    ).rejects.toBeInstanceOf(PluginOperatorDependencyError);
  });

  it('does not reveal dependency availability to an invalid operator context', async () => {
    const app = application(installationPort(), undefined);
    const input = {
      credentialBindingId: CREDENTIAL_BINDING_ID,
      installationId: INSTALLATION_ID,
      credentialName: 'oauth.access-token',
      secretValue: 'provider-token-value',
    } as const;
    const forged = {
      ...signedHeaders('POST', '/v1/plugins/credential-bindings'),
      signature: 'A'.repeat(43),
    };

    await expect(app.bindCredential(forged, input)).rejects.toMatchObject({
      name: 'IntegrationOperatorContextError',
      kind: 'invalid',
    });
  });

  it('forwards credential material only after exact signed operator authority', async () => {
    const credentials = credentialPort();
    const app = application(installationPort(), credentials);
    const input = {
      credentialBindingId: CREDENTIAL_BINDING_ID,
      installationId: INSTALLATION_ID,
      credentialName: 'oauth.access-token',
      secretValue: 'provider-token-value',
    } as const;

    const result = await app.bindCredential(
      signedHeaders('POST', '/v1/plugins/credential-bindings'),
      input,
    );

    expect(result).toEqual(CREDENTIAL_VIEW);
    expect(result).not.toHaveProperty('secretReference');
    expect(credentials.bind).toHaveBeenCalledWith({
      ...input,
      trustedContext: {
        workspaceId: WORKSPACE_ID,
        actorUserId: USER_ID,
      },
    });
  });

  it('binds credential revocation to its exact dynamic route', async () => {
    const credentials = credentialPort();
    const app = application(installationPort(), credentials);
    const path = `/v1/plugins/credential-bindings/${CREDENTIAL_BINDING_ID}/revoke`;

    const result = await app.revokeCredential(
      signedHeaders('POST', path),
      CREDENTIAL_BINDING_ID,
    );

    expect(result.status).toBe('revoked');
    expect(credentials.revoke).toHaveBeenCalledWith(
      { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
      CREDENTIAL_BINDING_ID,
    );
  });
});
