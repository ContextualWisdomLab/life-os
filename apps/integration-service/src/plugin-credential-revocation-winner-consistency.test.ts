import { describe, expect, it } from 'vitest';
import type { PluginInstallationContext } from './plugin-installation';
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
const OTHER_INSTALLATION_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const SECRET_REFERENCE = 'kms://life-os/plugin/revocation-consistency-reference-001';
const OTHER_SECRET_REFERENCE =
  'kms://life-os/plugin/revocation-consistency-reference-002';
const NOW = '2026-09-04T03:00:00.000Z';
const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});

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

class ConsistencyStore implements PluginCredentialBindingStore {
  constructor(
    readonly existing: PluginCredentialBindingRecord,
    readonly revokeWinner: PluginCredentialBindingRecord,
  ) {}

  async findById(): Promise<PluginCredentialBindingRecord | undefined> {
    return this.existing;
  }

  async createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    return record;
  }

  async revokeActive(
    _input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    return this.revokeWinner;
  }
}

class ConsistencySecretStore implements PluginSecretStore {
  readonly deletes: string[] = [];

  async putSecret(_input: PutPluginSecretInput): Promise<string> {
    return SECRET_REFERENCE;
  }

  async deleteSecret(secretReference: string): Promise<void> {
    this.deletes.push(secretReference);
  }
}

describe('PluginCredentialApplication revocation winner consistency', () => {
  it.each([
    ['installation identity', { installationId: OTHER_INSTALLATION_ID }],
    ['credential name', { credentialName: 'webhook.rotated' }],
    ['secret reference', { secretReference: OTHER_SECRET_REFERENCE }],
    ['binding timestamp', { boundAt: '2026-09-04T00:30:00.000Z' }],
  ] as const)(
    'rejects a durable revoke winner that mutates %s before provider deletion',
    async (_label, mutation) => {
      const existing = binding();
      const winner = binding({
        status: 'revoked',
        revokedAt: '2026-09-04T02:00:00.000Z',
        ...mutation,
      });
      const store = new ConsistencyStore(existing, winner);
      const secrets = new ConsistencySecretStore();
      const installationAuthority = {
        async getInstallation(
          _context: PluginInstallationContext,
          _installationId: string,
        ) {
          return undefined;
        },
      };
      const application = new PluginCredentialApplication(
        installationAuthority,
        store,
        secrets,
        () => new Date(NOW),
      );

      await expect(application.revoke(CONTEXT, BINDING_ID)).rejects.toBeInstanceOf(
        PluginCredentialError,
      );
      expect(secrets.deletes).toEqual([]);
    },
  );
});
