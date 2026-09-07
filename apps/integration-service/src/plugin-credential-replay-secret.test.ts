import { describe, expect, it } from 'vitest';
import {
  PluginCredentialApplication,
  PluginCredentialError,
  type PluginCredentialBindingRecord,
  type PluginCredentialBindingStore,
  type PluginSecretStore,
  type PutPluginSecretInput,
  type RevokePluginCredential,
} from './plugin-credential';
import type {
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const BOUND_AT = '2026-09-08T00:00:00.000Z';
const SECRET_VALUE = 'original-plugin-secret-value';
const SECRET_REFERENCE = 'lifeos-plugin-vault://44444444-4444-4444-8444-444444444444';
const CONTEXT = Object.freeze({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID });

const INSTALLATION: PluginInstallationRecord = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'example.plugin',
  pluginContractVersion: '1.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['lifeos.task.completed.v1']),
  status: 'active',
  installedAt: '2026-09-07T23:59:00.000Z',
  revokedAt: null,
});

const BINDING: PluginCredentialBindingRecord = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'webhook.signing',
  secretReference: SECRET_REFERENCE,
  status: 'active',
  boundAt: BOUND_AT,
  revokedAt: null,
});

class InstallationAuthority {
  async getInstallation(
    _context: PluginInstallationContext,
    _installationId: string,
  ): Promise<PluginInstallationRecord> {
    return INSTALLATION;
  }
}

class ExistingBindingStore implements PluginCredentialBindingStore {
  async findById(): Promise<PluginCredentialBindingRecord> {
    return BINDING;
  }
  async createIfAbsent(
    _record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    throw new Error('existing replay must not create metadata');
  }
  async revokeActive(
    _input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    return undefined;
  }
}

class ExactSecretStore implements PluginSecretStore {
  readonly verifications: PutPluginSecretInput[] = [];
  async putSecret(_input: PutPluginSecretInput): Promise<string> {
    throw new Error('existing replay must not create provider material');
  }
  async verifySecret(
    secretReference: string,
    input: PutPluginSecretInput,
  ): Promise<void> {
    this.verifications.push(input);
    if (
      secretReference !== SECRET_REFERENCE ||
      input.secretValue !== SECRET_VALUE
    ) {
      throw new Error('provider evidence does not match replay');
    }
  }
  async deleteSecret(_secretReference: string): Promise<void> {}
}

function application(secretStore: ExactSecretStore): PluginCredentialApplication {
  return new PluginCredentialApplication(
    new InstallationAuthority(),
    new ExistingBindingStore(),
    secretStore,
    () => new Date(BOUND_AT),
  );
}

function bindInput(secretValue: string) {
  return Object.freeze({
    trustedContext: CONTEXT,
    installationId: INSTALLATION_ID,
    credentialBindingId: BINDING_ID,
    credentialName: 'webhook.signing',
    secretValue,
  });
}

describe('Plugin credential replay secret authority', () => {
  it('requires provider-backed proof before accepting an exact durable replay', async () => {
    const secrets = new ExactSecretStore();
    await expect(application(secrets).bind(bindInput(SECRET_VALUE))).resolves.toMatchObject({
      credentialBindingId: BINDING_ID,
      status: 'active',
    });
    expect(secrets.verifications).toHaveLength(1);
  });

  it('rejects a reused binding identity carrying different secret material', async () => {
    const secrets = new ExactSecretStore();
    await expect(
      application(secrets).bind(bindInput('different-plugin-secret-value')),
    ).rejects.toBeInstanceOf(PluginCredentialError);
    expect(secrets.verifications).toHaveLength(1);
  });
});
