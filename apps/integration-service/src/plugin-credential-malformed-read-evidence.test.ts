import { describe, expect, it } from 'vitest';
import type {
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';
import {
  PluginCredentialApplication,
  PluginCredentialError,
  type PluginCredentialBindingRecord,
  type PluginCredentialBindingStore,
  type PluginSecretStore,
  type PutPluginSecretInput,
  type RevokePluginCredential,
} from './plugin-credential';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const SECRET_REFERENCE = 'kms://life-os/plugin/evidence-test-reference-001';
const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});
const BIND_INPUT = Object.freeze({
  trustedContext: CONTEXT,
  installationId: INSTALLATION_ID,
  credentialBindingId: BINDING_ID,
  credentialName: 'webhook.signing',
  secretValue: 'credential-value',
});

function activeInstallation(): PluginInstallationRecord {
  return Object.freeze({
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    pluginId: 'example.plugin',
    pluginContractVersion: '1.0.0',
    manifestSha256: 'a'.repeat(64),
    grantedCapabilities: Object.freeze(['delivery.https']),
    status: 'active',
    installedAt: '2026-09-04T00:00:00.000Z',
    revokedAt: null,
  });
}

function candidateBinding(): PluginCredentialBindingRecord {
  return Object.freeze({
    credentialBindingId: BINDING_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    credentialName: 'webhook.signing',
    secretReference: SECRET_REFERENCE,
    status: 'active',
    boundAt: '2026-09-04T01:00:00.000Z',
    revokedAt: null,
  });
}

class EvidenceBindingStore implements PluginCredentialBindingStore {
  existing: unknown = undefined;
  createWinner: unknown = candidateBinding();
  readonly creates: PluginCredentialBindingRecord[] = [];

  async findById(): Promise<PluginCredentialBindingRecord | undefined> {
    return this.existing as PluginCredentialBindingRecord | undefined;
  }

  async createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    this.creates.push(record);
    return this.createWinner as PluginCredentialBindingRecord;
  }

  async revokeActive(
    _input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    return undefined;
  }
}

class EvidenceSecretStore implements PluginSecretStore {
  readonly writes: PutPluginSecretInput[] = [];
  readonly deletes: string[] = [];

  async putSecret(input: PutPluginSecretInput): Promise<string> {
    this.writes.push(input);
    return SECRET_REFERENCE;
  }

  async deleteSecret(secretReference: string): Promise<void> {
    this.deletes.push(secretReference);
  }
}

function harness(bindingStore = new EvidenceBindingStore()): {
  readonly application: PluginCredentialApplication;
  readonly bindingStore: EvidenceBindingStore;
  readonly secretStore: EvidenceSecretStore;
} {
  const installationAuthority = {
    async getInstallation(
      _context: PluginInstallationContext,
      _installationId: string,
    ): Promise<PluginInstallationRecord | undefined> {
      return activeInstallation();
    },
  };
  const secretStore = new EvidenceSecretStore();
  return {
    application: new PluginCredentialApplication(
      installationAuthority,
      bindingStore,
      secretStore,
      () => new Date('2026-09-04T01:00:00.000Z'),
    ),
    bindingStore,
    secretStore,
  };
}

describe('PluginCredentialApplication durable read evidence', () => {
  it.each([null, false, 0, ''] as const)(
    'does not collapse malformed existing binding evidence %p into absence',
    async (existing) => {
      const bindingStore = new EvidenceBindingStore();
      bindingStore.existing = existing;
      const subject = harness(bindingStore);

      await expect(subject.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
        PluginCredentialError,
      );
      expect(subject.secretStore.writes).toEqual([]);
      expect(subject.bindingStore.creates).toEqual([]);
    },
  );

  it('compensates a newly written secret when create returns a malformed null winner', async () => {
    const bindingStore = new EvidenceBindingStore();
    bindingStore.createWinner = null;
    const subject = harness(bindingStore);

    await expect(subject.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
      PluginCredentialError,
    );
    expect(subject.secretStore.writes).toHaveLength(1);
    expect(subject.secretStore.deletes).toEqual([SECRET_REFERENCE]);
  });
});
