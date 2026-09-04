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
const SECRET_REFERENCE = 'kms://life-os/plugin/durable-record-reference-001';
const NOW = '2026-09-04T03:00:00.000Z';
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

function installation(): PluginInstallationRecord {
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

function binding(
  overrides: Partial<PluginCredentialBindingRecord> = {},
): PluginCredentialBindingRecord {
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
    ...overrides,
  });
}

class DurableStore implements PluginCredentialBindingStore {
  existing: PluginCredentialBindingRecord | undefined;
  createWinner: PluginCredentialBindingRecord | undefined;
  revokeWinner: PluginCredentialBindingRecord | undefined;

  async findById(): Promise<PluginCredentialBindingRecord | undefined> {
    return this.existing;
  }

  async createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    return this.createWinner ?? record;
  }

  async revokeActive(
    _input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    return this.revokeWinner;
  }
}

class SecretStore implements PluginSecretStore {
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

function harness(store = new DurableStore()): {
  readonly application: PluginCredentialApplication;
  readonly store: DurableStore;
  readonly secrets: SecretStore;
} {
  const authority = {
    async getInstallation(
      _context: PluginInstallationContext,
      _installationId: string,
    ): Promise<PluginInstallationRecord | undefined> {
      return installation();
    },
  };
  const secrets = new SecretStore();
  return {
    application: new PluginCredentialApplication(
      authority,
      store,
      secrets,
      () => new Date(NOW),
    ),
    store,
    secrets,
  };
}

describe('PluginCredentialApplication durable binding records', () => {
  it.each([
    ['non-canonical UUID', binding({ credentialBindingId: BINDING_ID.toUpperCase() })],
    ['malformed boundAt', binding({ boundAt: 'not-an-instant' })],
  ])('rejects malformed existing %s before writing secret material', async (_label, existing) => {
    const store = new DurableStore();
    store.existing = existing;
    const subject = harness(store);

    await expect(subject.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
      PluginCredentialError,
    );
    expect(subject.secrets.writes).toEqual([]);
    expect(subject.secrets.deletes).toEqual([]);
  });

  it('compensates the new provider secret when a create winner has malformed lifecycle time', async () => {
    const store = new DurableStore();
    store.createWinner = binding({ boundAt: 'not-an-instant' });
    const subject = harness(store);

    await expect(subject.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
      PluginCredentialError,
    );
    expect(subject.secrets.writes).toHaveLength(1);
    expect(subject.secrets.deletes).toEqual([SECRET_REFERENCE]);
  });

  it.each([
    [
      'malformed revokedAt',
      binding({ status: 'revoked', revokedAt: 'not-an-instant' }),
    ],
    [
      'revocation before binding',
      binding({
        status: 'revoked',
        revokedAt: '2026-09-04T00:30:00.000Z',
      }),
    ],
  ])('rejects revoked winner with %s before using its secret reference', async (_label, winner) => {
    const store = new DurableStore();
    store.existing = binding();
    store.revokeWinner = winner;
    const subject = harness(store);

    await expect(
      subject.application.revoke(CONTEXT, BINDING_ID),
    ).rejects.toBeInstanceOf(PluginCredentialError);
    expect(subject.secrets.deletes).toEqual([]);
  });
});
