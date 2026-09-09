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
const OPERATION_AT = '2026-09-10T00:00:00.000Z';
const NEW_SECRET_REFERENCE =
  'lifeos-plugin-vault://44444444-4444-4444-8444-444444444444/new';
const WINNER_SECRET_REFERENCE =
  'lifeos-plugin-vault://44444444-4444-4444-8444-444444444444/winner';
const SECRET_VALUE = 'requested-plugin-secret-value';

const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});

const INSTALLATION: PluginInstallationRecord = Object.freeze({
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  pluginId: 'example.plugin',
  pluginContractVersion: '1.0.0',
  manifestSha256: 'a'.repeat(64),
  grantedCapabilities: Object.freeze(['delivery.https']),
  status: 'active',
  installedAt: '2026-09-09T23:59:00.000Z',
  revokedAt: null,
});

const WINNER: PluginCredentialBindingRecord = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'webhook.signing',
  secretReference: WINNER_SECRET_REFERENCE,
  status: 'active',
  boundAt: OPERATION_AT,
  revokedAt: null,
});

class MutableInstallationAuthority {
  private installation: PluginInstallationRecord = INSTALLATION;

  async getInstallation(
    _context: PluginInstallationContext,
    _installationId: string,
  ): Promise<PluginInstallationRecord> {
    return this.installation;
  }

  revoke(): void {
    this.installation = Object.freeze({
      ...INSTALLATION,
      status: 'revoked',
      revokedAt: OPERATION_AT,
    });
  }
}

class ConcurrentWinnerStore implements PluginCredentialBindingStore {
  private created = false;
  private winner: PluginCredentialBindingRecord = WINNER;

  async findById(): Promise<PluginCredentialBindingRecord | undefined> {
    return this.created ? this.winner : undefined;
  }

  async createIfAbsent(
    _record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    this.created = true;
    return this.winner;
  }

  async revokeActive(
    _input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    return undefined;
  }

  revokeWinner(): void {
    this.winner = Object.freeze({
      ...WINNER,
      status: 'revoked',
      revokedAt: OPERATION_AT,
    });
  }
}

class ConcurrentWinnerSecretStore implements PluginSecretStore {
  readonly deletes: string[] = [];
  readonly verifications: Array<{
    readonly secretReference: string;
    readonly input: PutPluginSecretInput;
  }> = [];

  constructor(
    private readonly verificationMatches: boolean,
    private readonly afterVerification: () => void = () => undefined,
  ) {}

  async putSecret(_input: PutPluginSecretInput): Promise<string> {
    return NEW_SECRET_REFERENCE;
  }

  async verifySecret(
    secretReference: string,
    input: PutPluginSecretInput,
  ): Promise<void> {
    this.verifications.push({ secretReference, input });
    if (!this.verificationMatches) {
      throw new Error(
        'concurrent durable winner contains different secret bytes',
      );
    }
    this.afterVerification();
  }

  async deleteSecret(secretReference: string): Promise<void> {
    this.deletes.push(secretReference);
  }
}

function application(
  secretStore: ConcurrentWinnerSecretStore,
  installationAuthority = new MutableInstallationAuthority(),
  bindingStore = new ConcurrentWinnerStore(),
) {
  return new PluginCredentialApplication(
    installationAuthority,
    bindingStore,
    secretStore,
    () => new Date(OPERATION_AT),
  );
}

const BIND_INPUT = Object.freeze({
  trustedContext: CONTEXT,
  installationId: INSTALLATION_ID,
  credentialBindingId: BINDING_ID,
  credentialName: 'webhook.signing',
  secretValue: SECRET_VALUE,
});

const EXPECTED_SECRET_INPUT = Object.freeze({
  credentialBindingId: BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'webhook.signing',
  secretValue: SECRET_VALUE,
});

describe('Plugin credential concurrent durable winner secret authority', () => {
  it('rejects a concurrent durable winner until its provider-backed secret bytes are proven exact', async () => {
    const secretStore = new ConcurrentWinnerSecretStore(false);

    await expect(
      application(secretStore).bind(BIND_INPUT),
    ).rejects.toBeInstanceOf(PluginCredentialError);

    expect(secretStore.deletes).toEqual([NEW_SECRET_REFERENCE]);
    expect(secretStore.verifications).toEqual([
      {
        secretReference: WINNER_SECRET_REFERENCE,
        input: EXPECTED_SECRET_INPUT,
      },
    ]);
  });

  it('accepts an exact concurrent durable winner only after cleaning the loser and proving its secret bytes', async () => {
    const secretStore = new ConcurrentWinnerSecretStore(true);

    await expect(application(secretStore).bind(BIND_INPUT)).resolves.toEqual({
      credentialBindingId: BINDING_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      installedByUserId: USER_ID,
      credentialName: 'webhook.signing',
      status: 'active',
      boundAt: OPERATION_AT,
      revokedAt: null,
    });

    expect(secretStore.deletes).toEqual([NEW_SECRET_REFERENCE]);
    expect(secretStore.verifications).toEqual([
      {
        secretReference: WINNER_SECRET_REFERENCE,
        input: EXPECTED_SECRET_INPUT,
      },
    ]);
  });

  it('rejects a concurrent durable winner when installation authority is revoked during provider verification', async () => {
    const installationAuthority = new MutableInstallationAuthority();
    const bindingStore = new ConcurrentWinnerStore();
    const secretStore = new ConcurrentWinnerSecretStore(true, () =>
      installationAuthority.revoke(),
    );

    await expect(
      application(secretStore, installationAuthority, bindingStore).bind(
        BIND_INPUT,
      ),
    ).rejects.toBeInstanceOf(PluginCredentialError);

    expect(secretStore.deletes).toEqual([NEW_SECRET_REFERENCE]);
    expect(secretStore.verifications).toHaveLength(1);
  });

  it('rejects a concurrent durable winner when binding authority is revoked during provider verification', async () => {
    const installationAuthority = new MutableInstallationAuthority();
    const bindingStore = new ConcurrentWinnerStore();
    const secretStore = new ConcurrentWinnerSecretStore(true, () =>
      bindingStore.revokeWinner(),
    );

    await expect(
      application(secretStore, installationAuthority, bindingStore).bind(
        BIND_INPUT,
      ),
    ).rejects.toBeInstanceOf(PluginCredentialError);

    expect(secretStore.deletes).toEqual([NEW_SECRET_REFERENCE]);
    expect(secretStore.verifications).toHaveLength(1);
  });
});
