import { describe, expect, it } from 'vitest';
import type { PluginCredentialBindingRecord } from './plugin-credential';
import {
  PluginCredentialPersistenceValidationError,
  PostgresPluginCredentialBindingStore,
  type PluginCredentialSqlClient,
  type PluginCredentialSqlResult,
} from './plugin-credential-repository';
import type { PluginDeliveryOriginGrantRecord } from './plugin-delivery-origin-authority';
import {
  PluginDeliveryOriginPersistenceValidationError,
  PostgresPluginDeliveryOriginGrantStore,
  type PluginDeliveryOriginSqlClient,
  type PluginDeliveryOriginSqlResult,
} from './plugin-delivery-origin-repository';

const CREDENTIAL_BINDING_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const GRANT_ID = '55555555-5555-4555-8555-555555555555';
const BOUND_AT = '2026-09-09T08:00:00.000Z';
const REVOKED_AT = '2026-09-09T09:00:00.000Z';

const CREDENTIAL_RECORD: PluginCredentialBindingRecord = Object.freeze({
  credentialBindingId: CREDENTIAL_BINDING_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  installedByUserId: USER_ID,
  credentialName: 'webhook.signing',
  secretReference: 'kms://life-os/plugin/remaining-coverage-reference',
  status: 'active',
  boundAt: BOUND_AT,
  revokedAt: null,
});

const ORIGIN_RECORD: PluginDeliveryOriginGrantRecord = Object.freeze({
  authorityVersion: 'life-os.plugin-delivery-origin.v1',
  grantId: GRANT_ID,
  installationId: INSTALLATION_ID,
  workspaceId: WORKSPACE_ID,
  grantedByUserId: USER_ID,
  origin: 'https://api.example.com:8443',
  status: 'active',
  grantedAt: BOUND_AT,
  revokedAt: null,
});

class CredentialClient implements PluginCredentialSqlClient {
  readonly calls: string[] = [];

  constructor(
    private readonly results: Array<PluginCredentialSqlResult<Record<string, unknown>>>,
  ) {}

  async query<Row>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<PluginCredentialSqlResult<Row>> {
    this.calls.push(text);
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error('unexpected credential SQL query');
    }
    return result as PluginCredentialSqlResult<Row>;
  }
}

class OriginClient implements PluginDeliveryOriginSqlClient {
  readonly calls: string[] = [];

  constructor(
    private readonly results: Array<PluginDeliveryOriginSqlResult<Record<string, unknown>>>,
  ) {}

  async query<Row>(
    text: string,
    _values?: readonly unknown[],
  ): Promise<PluginDeliveryOriginSqlResult<Row>> {
    this.calls.push(text);
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error('unexpected origin SQL query');
    }
    return result as PluginDeliveryOriginSqlResult<Row>;
  }
}

function originRow(): Record<string, unknown> {
  return {
    authority_version: ORIGIN_RECORD.authorityVersion,
    grant_id: ORIGIN_RECORD.grantId,
    installation_id: ORIGIN_RECORD.installationId,
    workspace_id: ORIGIN_RECORD.workspaceId,
    granted_by_user_id: ORIGIN_RECORD.grantedByUserId,
    origin_uri: ORIGIN_RECORD.origin,
    grant_status: ORIGIN_RECORD.status,
    granted_at: new Date(ORIGIN_RECORD.grantedAt),
    revoked_at: null,
  };
}

describe('Integration persistence remaining validation branches', () => {
  it('rejects the remaining malformed credential create fields before SQL', async () => {
    const invalidRecords: PluginCredentialBindingRecord[] = [
      { ...CREDENTIAL_RECORD, boundAt: 'not-an-instant' },
      { ...CREDENTIAL_RECORD, credentialName: 'Webhook.Signing' },
      { ...CREDENTIAL_RECORD, secretReference: 'short' },
      {
        ...CREDENTIAL_RECORD,
        status: 'revoked',
        revokedAt: REVOKED_AT,
      },
    ];

    for (const record of invalidRecords) {
      const client = new CredentialClient([]);
      const store = new PostgresPluginCredentialBindingStore(client);
      await expect(store.createIfAbsent(record)).rejects.toBeInstanceOf(
        PluginCredentialPersistenceValidationError,
      );
      expect(client.calls).toEqual([]);
    }
  });

  it('fails closed when URL parsing rejects an authority-shaped durable origin input', async () => {
    const client = new OriginClient([]);
    const store = new PostgresPluginDeliveryOriginGrantStore(client);

    await expect(
      store.createIfAbsent({
        ...ORIGIN_RECORD,
        origin: 'https://api.example.com:99999',
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceValidationError);
    expect(client.calls).toEqual([]);
  });

  it('returns an exact durable delivery-origin row for a scoped read', async () => {
    const client = new OriginClient([
      { rows: [originRow()], rowCount: 1 },
    ]);
    const store = new PostgresPluginDeliveryOriginGrantStore(client);

    await expect(
      store.findById(GRANT_ID, INSTALLATION_ID, WORKSPACE_ID, USER_ID),
    ).resolves.toEqual(ORIGIN_RECORD);
    expect(client.calls).toHaveLength(1);
  });
});
