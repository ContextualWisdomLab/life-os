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
const SECRET_REFERENCE = 'kms://life-os/plugin/clock-test-reference-001';
const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});

interface ClockBoundaryCalls {
  installationReads: number;
  bindingReads: number;
  bindingCreates: number;
  bindingRevokes: number;
  secretWrites: number;
  secretDeletes: number;
}

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

function activeBinding(): PluginCredentialBindingRecord {
  return Object.freeze({
    credentialBindingId: BINDING_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    credentialName: 'webhook.signing',
    secretReference: SECRET_REFERENCE,
    status: 'active',
    boundAt: '2026-09-04T00:30:00.000Z',
    revokedAt: null,
  });
}

function harness(now: () => Date): {
  readonly application: PluginCredentialApplication;
  readonly calls: ClockBoundaryCalls;
} {
  const calls: ClockBoundaryCalls = {
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
      return activeInstallation();
    },
  };
  const bindingStore: PluginCredentialBindingStore = {
    async findById(): Promise<PluginCredentialBindingRecord | undefined> {
      calls.bindingReads += 1;
      return activeBinding();
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
      return Object.freeze({
        ...activeBinding(),
        status: 'revoked',
        revokedAt: '2026-09-04T01:00:00.000Z',
      });
    },
  };
  const secretStore: PluginSecretStore = {
    async putSecret(_input: PutPluginSecretInput): Promise<string> {
      calls.secretWrites += 1;
      return SECRET_REFERENCE;
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
      now,
    ),
    calls,
  };
}

const BIND_INPUT = Object.freeze({
  trustedContext: CONTEXT,
  installationId: INSTALLATION_ID,
  credentialBindingId: BINDING_ID,
  credentialName: 'webhook.signing',
  secretValue: 'credential-value',
});

const INVALID_CLOCKS = [
  () => new Date(Number.NaN),
  () => {
    throw new Error('clock unavailable');
  },
] as const;

describe('PluginCredentialApplication clock evidence', () => {
  it.each(INVALID_CLOCKS)(
    'rejects invalid bind clock before installation, persistence, or secret I/O',
    async (now) => {
      const subject = harness(now);

      await expect(subject.application.bind(BIND_INPUT)).rejects.toBeInstanceOf(
        PluginCredentialError,
      );
      expect(subject.calls).toEqual({
        installationReads: 0,
        bindingReads: 0,
        bindingCreates: 0,
        bindingRevokes: 0,
        secretWrites: 0,
        secretDeletes: 0,
      });
    },
  );

  it.each(INVALID_CLOCKS)(
    'rejects invalid revoke clock before persistence or secret I/O',
    async (now) => {
      const subject = harness(now);

      await expect(
        subject.application.revoke(CONTEXT, BINDING_ID),
      ).rejects.toBeInstanceOf(PluginCredentialError);
      expect(subject.calls).toEqual({
        installationReads: 0,
        bindingReads: 0,
        bindingCreates: 0,
        bindingRevokes: 0,
        secretWrites: 0,
        secretDeletes: 0,
      });
    },
  );
});
