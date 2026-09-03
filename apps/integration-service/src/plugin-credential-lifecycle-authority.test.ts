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
const SECRET_REFERENCE = 'kms://life-os/plugin/lifecycle-authority-reference-001';
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

function installation(
  overrides: Partial<PluginInstallationRecord> = {},
): PluginInstallationRecord {
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
    ...overrides,
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

class LifecycleStore implements PluginCredentialBindingStore {
  existing: PluginCredentialBindingRecord | undefined;
  createWinner: PluginCredentialBindingRecord | undefined;
  revokeWinner: PluginCredentialBindingRecord | undefined;
  reads = 0;
  creates = 0;
  revokes = 0;

  async findById(): Promise<PluginCredentialBindingRecord | undefined> {
    this.reads += 1;
    return this.existing;
  }

  async createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    this.creates += 1;
    return this.createWinner ?? record;
  }

  async revokeActive(
    _input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    this.revokes += 1;
    return this.revokeWinner;
  }
}

class LifecycleSecretStore implements PluginSecretStore {
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

function harness(options: {
  readonly installation?: PluginInstallationRecord;
  readonly store?: LifecycleStore;
} = {}): {
  readonly application: PluginCredentialApplication;
  readonly store: LifecycleStore;
  readonly secrets: LifecycleSecretStore;
} {
  const store = options.store ?? new LifecycleStore();
  const installationEvidence = options.installation ?? installation();
  const authority = {
    async getInstallation(
      _context: PluginInstallationContext,
      _installationId: string,
    ): Promise<PluginInstallationRecord | undefined> {
      return installationEvidence;
    },
  };
  const secrets = new LifecycleSecretStore();
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

describe('PluginCredentialApplication lifecycle authority', () => {
  it.each([
    ['malformed installedAt', installation({ installedAt: 'not-an-instant' })],
    [
      'future installedAt',
      installation({ installedAt: '2026-09-04T04:00:00.000Z' }),
    ],
    [
      'active status with revocation evidence',
      installation({ revokedAt: '2026-09-04T02:00:00.000Z' }),
    ],
  ])('rejects %s before persistence or secret materialization', async (_label, evidence) => {
    const subject = harness({ installation: evidence });

    await expect(subject.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
      PluginCredentialError,
    );
    expect(subject.store.reads).toBe(0);
    expect(subject.store.creates).toBe(0);
    expect(subject.secrets.writes).toEqual([]);
  });

  it('rejects a future-dated existing binding instead of exposing it as current authority', async () => {
    const store = new LifecycleStore();
    store.existing = binding({ boundAt: '2026-09-04T04:00:00.000Z' });
    const subject = harness({ store });

    await expect(subject.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
      PluginCredentialError,
    );
    expect(subject.store.creates).toBe(0);
    expect(subject.secrets.writes).toEqual([]);
  });

  it('compensates a newly written secret when the durable create winner is future-dated', async () => {
    const store = new LifecycleStore();
    store.createWinner = binding({ boundAt: '2026-09-04T04:00:00.000Z' });
    const subject = harness({ store });

    await expect(subject.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
      PluginCredentialError,
    );
    expect(subject.secrets.writes).toHaveLength(1);
    expect(subject.secrets.deletes).toEqual([SECRET_REFERENCE]);
  });

  it('rejects revocation when the existing binding is dated after the revocation authority instant', async () => {
    const store = new LifecycleStore();
    store.existing = binding({ boundAt: '2026-09-04T04:00:00.000Z' });
    const subject = harness({ store });

    await expect(
      subject.application.revoke(CONTEXT, BINDING_ID),
    ).rejects.toBeInstanceOf(PluginCredentialError);
    expect(subject.store.revokes).toBe(0);
    expect(subject.secrets.deletes).toEqual([]);
  });

  it('rejects a future-dated durable revocation replay before provider deletion', async () => {
    const store = new LifecycleStore();
    store.existing = binding();
    store.revokeWinner = binding({
      status: 'revoked',
      revokedAt: '2026-09-04T04:00:00.000Z',
    });
    const subject = harness({ store });

    await expect(
      subject.application.revoke(CONTEXT, BINDING_ID),
    ).rejects.toBeInstanceOf(PluginCredentialError);
    expect(subject.secrets.deletes).toEqual([]);
  });

  it('accepts an older exact durable revocation replay on a later idempotent retry', async () => {
    const store = new LifecycleStore();
    store.existing = binding({
      status: 'revoked',
      revokedAt: '2026-09-04T02:00:00.000Z',
    });
    store.revokeWinner = store.existing;
    const subject = harness({ store });

    await expect(
      subject.application.revoke(CONTEXT, BINDING_ID),
    ).resolves.toMatchObject({
      credentialBindingId: BINDING_ID,
      status: 'revoked',
      revokedAt: '2026-09-04T02:00:00.000Z',
    });
    expect(subject.secrets.deletes).toEqual([SECRET_REFERENCE]);
  });
});
