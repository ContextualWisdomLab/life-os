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
const ISSUED_AT = 1_700_000_000;

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

function environment(): Readonly<Record<string, string>> {
  return Object.freeze({
    INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
    INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
    INTEGRATION_PLUGIN_VAULT_TOKEN: VAULT_TOKEN,
    INTEGRATION_PLUGIN_VAULT_MOUNT: 'secret',
  });
}

function signedHeaders(): Readonly<{
  workspaceId: string;
  userId: string;
  evidenceId: string;
  issuedAt: string;
  signature: string;
}> {
  const issuedAt = String(ISSUED_AT);
  const signature = createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.integration-operator-context.v1\n${WORKSPACE_ID}\n${USER_ID}\n${EVIDENCE_ID}\n${issuedAt}\nPOST\n/v1/plugins/credential-bindings`,
      'utf8',
    )
    .digest('base64url');
  return Object.freeze({
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    evidenceId: EVIDENCE_ID,
    issuedAt,
    signature,
  });
}

describe('Plugin Vault operator composition', () => {
  it('fails closed at composition when operator-owned Vault configuration is incomplete', () => {
    const installations = new InstallationPort();
    const bindingStore = new BindingStore();
    const replayGuard: PluginOperatorReplayGuardPort = {
      consume: vi.fn(async () => true),
    };

    expect(() =>
      createPluginVaultOperatorApplication(
        { installations, bindingStore, replayGuard },
        {
          INTEGRATION_OPERATOR_CONTEXT_SECRET: CONTEXT_SECRET,
          INTEGRATION_PLUGIN_VAULT_ORIGIN: 'https://vault.example.test',
          INTEGRATION_PLUGIN_VAULT_TOKEN: VAULT_TOKEN,
        },
      ),
    ).toThrow(PluginVaultOperatorCompositionError);
  });

  it('binds credential authority through the composed Vault store after signed operator verification', async () => {
    const installations = new InstallationPort();
    const bindingStore = new BindingStore();
    const replayGuard: PluginOperatorReplayGuardPort = {
      consume: vi.fn(async () => true),
    };
    const http = vi.fn<PluginVaultHttpClient>().mockResolvedValue(response(200));
    const operator = createPluginVaultOperatorApplication(
      { installations, bindingStore, replayGuard },
      environment(),
      http,
      () => ISSUED_AT,
      () => new Date('2023-11-14T22:13:20.000Z'),
    );

    const result = await operator.bindCredential(signedHeaders(), {
      credentialBindingId: BINDING_ID,
      installationId: INSTALLATION_ID,
      credentialName: 'webhook.signing',
      secretValue: 'buyer secret fixture',
    });

    expect(result).toEqual({
      credentialBindingId: BINDING_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      installedByUserId: USER_ID,
      credentialName: 'webhook.signing',
      status: 'active',
      boundAt: '2023-11-14T22:13:20.000Z',
      revokedAt: null,
    });
    expect(http).toHaveBeenCalledTimes(1);
    expect(replayGuard.consume).toHaveBeenCalledTimes(1);
  });
});
