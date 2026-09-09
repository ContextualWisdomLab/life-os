import { describe, expect, it, vi } from 'vitest';
import type {
  PluginInstallationContext,
  PluginInstallationRecord,
} from './plugin-installation';
import {
  PluginCredentialApplication,
  PluginCredentialError,
  type PluginCredentialBindingRecord,
  type PluginCredentialBindingStore,
  type PluginInstallationAuthority,
  type PluginSecretStore,
} from './plugin-credential';

const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const BOUND_AT = '2026-08-10T07:00:00.000Z';
const REVOKED_AT = '2026-08-10T08:00:00.000Z';
const SECRET_VALUE = 'plugin-secret-value-that-must-never-enter-metadata';
const SECRET_REFERENCE = 'kms://life-os/plugin/opaque-reference-001';

const CONTEXT: PluginInstallationContext = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
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
    grantedCapabilities: Object.freeze(['lifeos.task.completed.v1']),
    status: 'active',
    installedAt: '2026-08-10T06:00:00.000Z',
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
    boundAt: BOUND_AT,
    revokedAt: null,
    ...overrides,
  });
}

const BIND_INPUT = Object.freeze({
  trustedContext: CONTEXT,
  installationId: INSTALLATION_ID,
  credentialBindingId: BINDING_ID,
  credentialName: 'webhook.signing',
  secretValue: SECRET_VALUE,
});

function ports(): {
  readonly installationAuthority: PluginInstallationAuthority & {
    readonly getInstallation: ReturnType<typeof vi.fn>;
  };
  readonly bindingStore: PluginCredentialBindingStore & {
    readonly findById: ReturnType<typeof vi.fn>;
    readonly createIfAbsent: ReturnType<typeof vi.fn>;
    readonly revokeActive: ReturnType<typeof vi.fn>;
  };
  readonly secretStore: PluginSecretStore & {
    readonly putSecret: ReturnType<typeof vi.fn>;
    readonly verifySecret: ReturnType<typeof vi.fn>;
    readonly deleteSecret: ReturnType<typeof vi.fn>;
  };
} {
  return {
    installationAuthority: {
      getInstallation: vi.fn(async () => installation()),
    },
    bindingStore: {
      findById: vi.fn(async () => undefined),
      createIfAbsent: vi.fn(async (record: PluginCredentialBindingRecord) => record),
      revokeActive: vi.fn(async () => undefined),
    },
    secretStore: {
      putSecret: vi.fn(async () => SECRET_REFERENCE),
      verifySecret: vi.fn(async () => undefined),
      deleteSecret: vi.fn(async () => undefined),
    },
  };
}

function application(
  owned = ports(),
  now: (() => Date) | undefined = () => new Date(BOUND_AT),
): PluginCredentialApplication {
  return now === undefined
    ? new PluginCredentialApplication(
        owned.installationAuthority,
        owned.bindingStore,
        owned.secretStore,
      )
    : new PluginCredentialApplication(
        owned.installationAuthority,
        owned.bindingStore,
        owned.secretStore,
        now,
      );
}

async function expectInvalid(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(PluginCredentialError);
}

describe('Plugin credential hostile-boundary coverage', () => {
  it('bounds a throwing operation clock before any installation authority is used', async () => {
    const owned = ports();
    const subject = application(owned, () => {
      throw new Error('clock fixture');
    });

    await expectInvalid(subject.bind(BIND_INPUT));
    expect(owned.installationAuthority.getInstallation).not.toHaveBeenCalled();
  });

  it.each([undefined, '', `safe${String.fromCharCode(0)}secret`])(
    'rejects malformed secret material %j before authority I/O',
    async (secretValue) => {
      const owned = ports();
      const subject = application(owned);

      await expectInvalid(
        subject.bind({ ...BIND_INPUT, secretValue: secretValue as string }),
      );
      expect(owned.installationAuthority.getInstallation).not.toHaveBeenCalled();
    },
  );

  it('uses the production clock when no explicit clock is injected', async () => {
    const owned = ports();
    const subject = application(owned, undefined);

    await expect(subject.bind(BIND_INPUT)).resolves.toEqual(
      expect.objectContaining({
        credentialBindingId: BINDING_ID,
        status: 'active',
      }),
    );
  });

  it('bounds replay secret verification rejection', async () => {
    const owned = ports();
    owned.bindingStore.findById.mockResolvedValue(binding());
    owned.secretStore.verifySecret.mockRejectedValue(new Error('vault fixture'));

    await expectInvalid(application(owned).bind(BIND_INPUT));
  });

  it('bounds replay installation re-read rejection', async () => {
    const owned = ports();
    owned.bindingStore.findById.mockResolvedValue(binding());
    owned.installationAuthority.getInstallation
      .mockResolvedValueOnce(installation())
      .mockRejectedValueOnce(new Error('installation fixture'));

    await expectInvalid(application(owned).bind(BIND_INPUT));
  });

  it('bounds replay binding re-read rejection and disappearance', async () => {
    const rejecting = ports();
    rejecting.bindingStore.findById
      .mockResolvedValueOnce(binding())
      .mockRejectedValueOnce(new Error('binding fixture'));
    await expectInvalid(application(rejecting).bind(BIND_INPUT));

    const disappearing = ports();
    disappearing.bindingStore.findById
      .mockResolvedValueOnce(binding())
      .mockResolvedValueOnce(undefined);
    await expectInvalid(application(disappearing).bind(BIND_INPUT));
  });

  it('bounds secret-store put rejection before durable metadata creation', async () => {
    const owned = ports();
    owned.secretStore.putSecret.mockRejectedValue(new Error('vault fixture'));

    await expectInvalid(application(owned).bind(BIND_INPUT));
    expect(owned.bindingStore.createIfAbsent).not.toHaveBeenCalled();
  });

  it('fails closed on durable-create rejection even when orphan cleanup also rejects', async () => {
    const owned = ports();
    owned.bindingStore.createIfAbsent.mockRejectedValue(
      new Error('database fixture'),
    );
    owned.secretStore.deleteSecret.mockRejectedValue(new Error('cleanup fixture'));

    await expectInvalid(application(owned).bind(BIND_INPUT));
    expect(owned.secretStore.deleteSecret).toHaveBeenCalledWith(SECRET_REFERENCE);
  });

  it('fails closed on an invalid durable winner even when cleanup rejects', async () => {
    const owned = ports();
    owned.bindingStore.createIfAbsent.mockResolvedValue(
      binding({ credentialName: 'different.slot' }),
    );
    owned.secretStore.deleteSecret.mockRejectedValue(new Error('cleanup fixture'));

    await expectInvalid(application(owned).bind(BIND_INPUT));
    expect(owned.secretStore.deleteSecret).toHaveBeenCalledWith(SECRET_REFERENCE);
  });

  it('accepts a same-authority durable winner with a different opaque reference after removing the local orphan', async () => {
    const owned = ports();
    const durableReference = 'kms://life-os/plugin/durable-reference-002';
    owned.bindingStore.createIfAbsent.mockResolvedValue(
      binding({ secretReference: durableReference }),
    );

    await expect(application(owned).bind(BIND_INPUT)).resolves.toEqual(
      expect.objectContaining({ credentialBindingId: BINDING_ID }),
    );
    expect(owned.secretStore.deleteSecret).toHaveBeenCalledWith(SECRET_REFERENCE);
  });

  it('fails closed when local-orphan cleanup fails after a same-authority durable winner', async () => {
    const owned = ports();
    owned.bindingStore.createIfAbsent.mockResolvedValue(
      binding({ secretReference: 'kms://life-os/plugin/durable-reference-003' }),
    );
    owned.secretStore.deleteSecret.mockRejectedValue(new Error('cleanup fixture'));

    await expectInvalid(application(owned).bind(BIND_INPUT));
  });

  it('rejects missing existing and missing durable revoke evidence', async () => {
    const missingExisting = ports();
    await expectInvalid(application(missingExisting).revoke(CONTEXT, BINDING_ID));

    const missingDurable = ports();
    missingDurable.bindingStore.findById.mockResolvedValue(binding());
    await expectInvalid(application(missingDurable).revoke(CONTEXT, BINDING_ID));
  });

  it('rejects revoke evidence that changes immutable binding authority', async () => {
    const owned = ports();
    owned.bindingStore.findById.mockResolvedValue(binding());
    owned.bindingStore.revokeActive.mockResolvedValue(
      binding({
        status: 'revoked',
        revokedAt: REVOKED_AT,
        secretReference: 'kms://life-os/plugin/redirected-reference-004',
      }),
    );

    await expectInvalid(
      application(owned, () => new Date(REVOKED_AT)).revoke(CONTEXT, BINDING_ID),
    );
    expect(owned.secretStore.deleteSecret).not.toHaveBeenCalled();
  });
});
