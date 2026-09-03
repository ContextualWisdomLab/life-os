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

interface BoundaryCalls {
  installationReads: number;
  bindingReads: number;
  bindingCreates: number;
  bindingRevokes: number;
  secretWrites: number;
  secretDeletes: number;
}

function harness(): {
  readonly application: PluginCredentialApplication;
  readonly calls: BoundaryCalls;
} {
  const calls: BoundaryCalls = {
    installationReads: 0,
    bindingReads: 0,
    bindingCreates: 0,
    bindingRevokes: 0,
    secretWrites: 0,
    secretDeletes: 0,
  };

  const installationAuthority = {
    async getInstallation(
      _context: PluginInstallationContext,
      _installationId: string,
    ): Promise<PluginInstallationRecord | undefined> {
      calls.installationReads += 1;
      return undefined;
    },
  };
  const bindingStore: PluginCredentialBindingStore = {
    async findById(): Promise<PluginCredentialBindingRecord | undefined> {
      calls.bindingReads += 1;
      return undefined;
    },
    async createIfAbsent(
      record: PluginCredentialBindingRecord,
    ): Promise<PluginCredentialBindingRecord> {
      calls.bindingCreates += 1;
      return record;
    },
    async revokeActive(
      _input: RevokePluginCredential,
    ): Promise<PluginCredentialBindingRecord | undefined> {
      calls.bindingRevokes += 1;
      return undefined;
    },
  };
  const secretStore: PluginSecretStore = {
    async putSecret(_input: PutPluginSecretInput): Promise<string> {
      calls.secretWrites += 1;
      return 'kms://life-os/plugin/test-reference-001';
    },
    async deleteSecret(_secretReference: string): Promise<void> {
      calls.secretDeletes += 1;
    },
  };

  return {
    application: new PluginCredentialApplication(
      installationAuthority,
      bindingStore,
      secretStore,
      () => new Date('2026-09-04T03:00:00.000Z'),
    ),
    calls,
  };
}

function expectNoAuthorityIo(calls: BoundaryCalls): void {
  expect(calls).toEqual({
    installationReads: 0,
    bindingReads: 0,
    bindingCreates: 0,
    bindingRevokes: 0,
    secretWrites: 0,
    secretDeletes: 0,
  });
}

const VALID_BIND_INPUT = Object.freeze({
  trustedContext: Object.freeze({
    workspaceId: WORKSPACE_ID,
    actorUserId: USER_ID,
  }),
  installationId: INSTALLATION_ID,
  credentialBindingId: BINDING_ID,
  credentialName: 'webhook.signing',
  secretValue: 'credential-value',
});

describe('PluginCredentialApplication malformed authority envelopes', () => {
  it.each([null, undefined, 'invalid', []] as const)(
    'rejects malformed bind command envelope %p before authority or secret I/O',
    async (input) => {
      const subject = harness();

      await expect(subject.application.bind(input as never)).rejects.toBeInstanceOf(
        PluginCredentialError,
      );
      expectNoAuthorityIo(subject.calls);
    },
  );

  it.each([null, undefined, 'invalid', []] as const)(
    'rejects malformed trusted context %p before bind authority or secret I/O',
    async (trustedContext) => {
      const subject = harness();

      await expect(
        subject.application.bind({
          ...VALID_BIND_INPUT,
          trustedContext: trustedContext as never,
        }),
      ).rejects.toBeInstanceOf(PluginCredentialError);
      expectNoAuthorityIo(subject.calls);
    },
  );

  it.each([null, undefined, 'invalid', []] as const)(
    'rejects malformed revoke context %p before persistence or secret I/O',
    async (trustedContext) => {
      const subject = harness();

      await expect(
        subject.application.revoke(trustedContext as never, BINDING_ID),
      ).rejects.toBeInstanceOf(PluginCredentialError);
      expectNoAuthorityIo(subject.calls);
    },
  );
});
