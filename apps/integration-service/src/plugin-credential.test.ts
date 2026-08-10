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
const OTHER_USER_ID = '55555555-5555-4555-8555-555555555555';
const BOUND_AT = '2026-08-10T07:00:00.000Z';
const REVOKED_AT = '2026-08-10T08:00:00.000Z';
const SECRET_VALUE = 'plugin-secret-value-that-must-never-enter-metadata';
const SECRET_REFERENCE = 'kms://life-os/plugin/opaque-reference-001';

function installation(
  status: 'active' | 'revoked' = 'active',
): PluginInstallationRecord {
  return Object.freeze({
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    pluginId: 'example.plugin',
    pluginContractVersion: '1.0.0',
    manifestSha256: 'a'.repeat(64),
    grantedCapabilities: Object.freeze(['lifeos.task.completed.v1']),
    status,
    installedAt: '2026-08-10T06:00:00.000Z',
    revokedAt: status === 'revoked' ? REVOKED_AT : null,
  });
}

function binding(
  status: 'active' | 'revoked' = 'active',
): PluginCredentialBindingRecord {
  return Object.freeze({
    credentialBindingId: BINDING_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    credentialName: 'webhook.signing',
    secretReference: SECRET_REFERENCE,
    status,
    boundAt: BOUND_AT,
    revokedAt: status === 'revoked' ? REVOKED_AT : null,
  });
}

class InstallationAuthority {
  record: PluginInstallationRecord | undefined = installation();
  readonly lookups: Array<{
    readonly context: PluginInstallationContext;
    readonly installationId: string;
  }> = [];

  async getInstallation(
    context: PluginInstallationContext,
    installationId: string,
  ): Promise<PluginInstallationRecord | undefined> {
    this.lookups.push({ context, installationId });
    return this.record;
  }
}

class RecordingBindingStore implements PluginCredentialBindingStore {
  existing: PluginCredentialBindingRecord | undefined;
  createdResult: PluginCredentialBindingRecord | undefined;
  revokedResult: PluginCredentialBindingRecord | undefined;
  readonly lookups: unknown[][] = [];
  readonly creates: PluginCredentialBindingRecord[] = [];
  readonly revokes: RevokePluginCredential[] = [];

  async findById(
    credentialBindingId: string,
    workspaceId: string,
    installedByUserId: string,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    this.lookups.push([credentialBindingId, workspaceId, installedByUserId]);
    return this.existing;
  }

  async createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    this.creates.push(record);
    return this.createdResult ?? record;
  }

  async revokeActive(
    input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    this.revokes.push(input);
    return this.revokedResult;
  }
}

class RecordingSecretStore implements PluginSecretStore {
  readonly puts: PutPluginSecretInput[] = [];
  readonly deletes: string[] = [];
  reference = SECRET_REFERENCE;
  deleteFailure: Error | undefined;

  async putSecret(input: PutPluginSecretInput): Promise<string> {
    this.puts.push(input);
    return this.reference;
  }

  async deleteSecret(secretReference: string): Promise<void> {
    this.deletes.push(secretReference);
    if (this.deleteFailure) {
      throw this.deleteFailure;
    }
  }
}

function application(
  authority = new InstallationAuthority(),
  bindingStore = new RecordingBindingStore(),
  secretStore = new RecordingSecretStore(),
): {
  readonly authority: InstallationAuthority;
  readonly bindingStore: RecordingBindingStore;
  readonly secretStore: RecordingSecretStore;
  readonly application: PluginCredentialApplication;
} {
  return {
    authority,
    bindingStore,
    secretStore,
    application: new PluginCredentialApplication(
      authority,
      bindingStore,
      secretStore,
      () => new Date(BOUND_AT),
    ),
  };
}

const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});

const BIND_INPUT = Object.freeze({
  trustedContext: CONTEXT,
  installationId: INSTALLATION_ID,
  credentialBindingId: BINDING_ID,
  credentialName: 'webhook.signing',
  secretValue: SECRET_VALUE,
});

describe('PluginCredentialApplication', () => {
  it('stores secret material only through the secret-store port and persists only its opaque reference', async () => {
    const harness = application();

    const result = await harness.application.bind(BIND_INPUT);

    expect(harness.authority.lookups).toEqual([
      { context: CONTEXT, installationId: INSTALLATION_ID },
    ]);
    expect(harness.secretStore.puts).toEqual([
      {
        credentialBindingId: BINDING_ID,
        installationId: INSTALLATION_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        credentialName: 'webhook.signing',
        secretValue: SECRET_VALUE,
      },
    ]);
    expect(harness.bindingStore.creates).toEqual([binding()]);
    expect(JSON.stringify(harness.bindingStore.creates)).not.toContain(SECRET_VALUE);
    expect(result).toEqual({
      credentialBindingId: BINDING_ID,
      installationId: INSTALLATION_ID,
      workspaceId: WORKSPACE_ID,
      installedByUserId: USER_ID,
      credentialName: 'webhook.signing',
      status: 'active',
      boundAt: BOUND_AT,
      revokedAt: null,
    });
    expect(JSON.stringify(result)).not.toContain(SECRET_REFERENCE);
  });

  it('returns an exact durable replay without rematerializing or replacing secret material', async () => {
    const bindingStore = new RecordingBindingStore();
    bindingStore.existing = binding();
    const harness = application(
      new InstallationAuthority(),
      bindingStore,
      new RecordingSecretStore(),
    );

    await expect(harness.application.bind(BIND_INPUT)).resolves.toEqual(
      expect.objectContaining({ credentialBindingId: BINDING_ID, status: 'active' }),
    );
    expect(harness.secretStore.puts).toEqual([]);
    expect(harness.bindingStore.creates).toEqual([]);
  });

  it('fails closed before secret storage when installation authority is missing, revoked, or cross-user', async () => {
    for (const record of [undefined, installation('revoked')] as const) {
      const authority = new InstallationAuthority();
      authority.record = record;
      const harness = application(
        authority,
        new RecordingBindingStore(),
        new RecordingSecretStore(),
      );
      await expect(harness.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
        PluginCredentialError,
      );
      expect(harness.secretStore.puts).toEqual([]);
    }

    const authority = new InstallationAuthority();
    authority.record = Object.freeze({
      ...installation(),
      installedByUserId: OTHER_USER_ID,
    });
    const harness = application(
      authority,
      new RecordingBindingStore(),
      new RecordingSecretStore(),
    );
    await expect(harness.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
      PluginCredentialError,
    );
    expect(harness.secretStore.puts).toEqual([]);
  });

  it('cleans up a newly stored secret when a conflicting durable winner appears', async () => {
    const bindingStore = new RecordingBindingStore();
    bindingStore.createdResult = Object.freeze({
      ...binding(),
      credentialName: 'different.slot',
      secretReference: 'kms://life-os/plugin/other-reference-002',
    });
    const harness = application(
      new InstallationAuthority(),
      bindingStore,
      new RecordingSecretStore(),
    );

    await expect(harness.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
      PluginCredentialError,
    );
    expect(harness.secretStore.deletes).toEqual([SECRET_REFERENCE]);
  });

  it('revokes durable authority before deleting secret material and retries deletion on an exact revoked replay', async () => {
    const bindingStore = new RecordingBindingStore();
    bindingStore.existing = binding();
    bindingStore.revokedResult = binding('revoked');
    const secretStore = new RecordingSecretStore();
    secretStore.deleteFailure = new Error('provider unavailable');
    const harness = application(
      new InstallationAuthority(),
      bindingStore,
      secretStore,
    );

    await expect(
      harness.application.revoke(CONTEXT, BINDING_ID),
    ).rejects.toBeInstanceOf(PluginCredentialError);
    expect(bindingStore.revokes).toEqual([
      {
        credentialBindingId: BINDING_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        revokedAt: BOUND_AT,
      },
    ]);
    expect(secretStore.deletes).toEqual([SECRET_REFERENCE]);

    secretStore.deleteFailure = undefined;
    await expect(harness.application.revoke(CONTEXT, BINDING_ID)).resolves.toEqual(
      expect.objectContaining({ credentialBindingId: BINDING_ID, status: 'revoked' }),
    );
    expect(secretStore.deletes).toEqual([SECRET_REFERENCE, SECRET_REFERENCE]);
  });
});
