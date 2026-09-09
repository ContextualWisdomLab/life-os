import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type {
  PluginCredentialBindingRecord,
  PluginCredentialBindingStore,
} from './plugin-credential';
import type {
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';
import type { PluginInstallationOperatorPort } from './plugin-operator-application';
import type { PluginOperatorReplayGuardPort } from './plugin-operator-replay';
import type {
  PluginVaultHttpClient,
  PluginVaultHttpResponse,
} from './plugin-vault-secret-store';
import {
  createPluginVaultOperatorApplication,
  PluginVaultOperatorCompositionError,
} from './plugin-vault-operator-composition';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INSTALLATION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BINDING_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVIDENCE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CONTEXT_SECRET = 'operator-context-fixture-value-32-bytes-minimum';
const VAULT_TOKEN = 'vault-fixture-token-value';

const INSTALLATION: PluginInstallationRecord = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'example.plugin',
  pluginContractVersion: '1.0.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['event.task.completed']),
  status: 'active',
  installedAt: '2023-11-14T22:13:19.000Z',
  revokedAt: null,
});

class InstallationPort implements PluginInstallationOperatorPort {
  async install(): Promise<PluginInstallationRecord> {
    return INSTALLATION;
  }

  async getInstallation(
    context: PluginInstallationContext,
    installationId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    return context.workspaceId === WORKSPACE_ID &&
      context.actorUserId === USER_ID &&
      installationId === INSTALLATION_ID
      ? INSTALLATION
      : undefined;
  }

  async revoke(): Promise<PluginInstallationRecord> {
    return Object.freeze({
      ...INSTALLATION,
      status: 'revoked',
      revokedAt: '2023-11-14T22:13:21.000Z',
    });
  }
}

class BindingStore implements PluginCredentialBindingStore {
  private record: PluginCredentialBindingRecord | undefined;

  async findById(): Promise<PluginCredentialBindingRecord | undefined> {
    return this.record;
  }

  async createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    this.record ??= record;
    return this.record;
  }

  async revokeActive(): Promise<PluginCredentialBindingRecord | undefined> {
    return this.record;
  }
}

function dependencies(): Readonly<{
  installations: InstallationPort;
  bindingStore: BindingStore;
  replayGuard: PluginOperatorReplayGuardPort;
}> {
  return Object.freeze({
    installations: new InstallationPort(),
    bindingStore: new BindingStore(),
    replayGuard: { consume: vi.fn(async () => true) },
  });
}

function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
    INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
    INTEGRATION_PLUGIN_VAULT_TOKEN: VAULT_TOKEN,
    INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
    ...overrides,
  });
}

function response(status: number): PluginVaultHttpResponse {
  return {
    status,
    headers: { get: () => null },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
  };
}

function signedHeadersAt(issuedAt: number): Readonly<{
  workspaceId: string;
  userId: string;
  evidenceId: string;
  issuedAt: string;
  signature: string;
}> {
  const issuedAtText = String(issuedAt);
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    evidenceId: EVIDENCE_ID,
    issuedAt: issuedAtText,
    signature: createHmac('sha256', CONTEXT_SECRET)
      .update(
        `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${EVIDENCE_ID}\n${issuedAtText}\nPOST\n/v1/plugins/credential-bindings`,
        'utf8',
      )
      .digest('base64url'),
  });
}

describe('Plugin Vault operator composition coverage boundaries', () => {
  it('fails closed for malformed durable dependency ports and runtime functions', () => {
    const valid = dependencies();
    const invalidDependencies: unknown[] = [
      null,
      { ...valid, installations: {} },
      { ...valid, bindingStore: {} },
      { ...valid, replayGuard: {} },
      { ...valid, deliveryStatus: {} },
    ];

    for (const candidate of invalidDependencies) {
      expect(() =>
        createPluginVaultOperatorApplication(
          candidate as typeof valid,
          environment(),
        ),
      ).toThrow(PluginVaultOperatorCompositionError);
    }

    expect(() =>
      createPluginVaultOperatorApplication(
        valid,
        environment(),
        undefined,
        0 as never,
      ),
    ).toThrow(PluginVaultOperatorCompositionError);
    expect(() =>
      createPluginVaultOperatorApplication(
        valid,
        environment(),
        undefined,
        () => 1_700_000_000,
        0 as never,
      ),
    ).toThrow(PluginVaultOperatorCompositionError);
  });

  it('fails closed for malformed environment, verifier secret, and Vault construction', () => {
    const valid = dependencies();
    const invalidEnvironments: unknown[] = [
      null,
      [],
      environment({ INTEGRATION_PLUGIN_VAULT_MOUNT: undefined }),
      environment({ INTEGRATION_OPERATOR_CONTEXT_SECRET: 'short' }),
      environment({
        INTEGRATION_OPERATOR_CONTEXT_SECRET: 'x'.repeat(8_193),
      }),
      environment({ INTEGRATION_PLUGIN_VAULT_ORIGIN: 'http://vault.example.test' }),
    ];

    for (const candidate of invalidEnvironments) {
      expect(() =>
        createPluginVaultOperatorApplication(valid, candidate as never),
      ).toThrow(PluginVaultOperatorCompositionError);
    }
  });

  it('uses the production default clocks while retaining signed operator and Vault boundaries', async () => {
    const issuedAt = Math.floor(Date.now() / 1_000);
    const http = vi.fn<PluginVaultHttpClient>().mockResolvedValue(response(200));
    const operator = createPluginVaultOperatorApplication(
      dependencies(),
      environment(),
      http,
    );

    const result = await operator.bindCredential(signedHeadersAt(issuedAt), {
      credentialBindingId: BINDING_ID,
      installationId: INSTALLATION_ID,
      credentialName: 'webhook.signing',
      secretValue: 'buyer secret fixture',
    });

    expect(result.status).toBe('active');
    expect(result.workspaceId).toBe(WORKSPACE_ID);
    expect(result.installedByUserId).toBe(USER_ID);
    expect(result.boundAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
    expect(http).toHaveBeenCalledTimes(1);
  });
});
