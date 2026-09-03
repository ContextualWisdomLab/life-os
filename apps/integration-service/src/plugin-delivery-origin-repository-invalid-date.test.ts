import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryOriginPersistenceEvidenceError,
  PostgresPluginDeliveryOriginGrantStore,
  type PluginDeliveryOriginSqlClient,
  type PluginDeliveryOriginSqlResult,
} from './plugin-delivery-origin-repository';

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

function durableRow(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    authority_version: 'life-os.plugin-delivery-origin.v1',
    grant_id: GRANT_ID,
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    granted_by_user_id: USER_ID,
    origin_uri: 'https://api.example.com:8443',
    grant_status: 'active',
    granted_at: new Date('2026-09-01T20:00:00.000Z'),
    revoked_at: null,
    ...overrides,
  };
}

class EvidenceClient implements PluginDeliveryOriginSqlClient {
  constructor(private readonly evidence: Record<string, unknown>) {}

  async query<Row>(): Promise<PluginDeliveryOriginSqlResult<Row>> {
    return {
      rows: [this.evidence as Row],
      rowCount: 1,
    };
  }
}

describe('plugin delivery-origin malformed Date evidence', () => {
  it.each([
    ['granted_at', durableRow({ granted_at: new Date(Number.NaN) })],
    [
      'revoked_at',
      durableRow({
        grant_status: 'revoked',
        revoked_at: new Date(Number.NaN),
      }),
    ],
  ])('maps an invalid %s Date to the bounded persistence evidence error', async (_field, evidence) => {
    const store = new PostgresPluginDeliveryOriginGrantStore(
      new EvidenceClient(evidence),
    );

    await expect(
      store.findById(GRANT_ID, INSTALLATION_ID, WORKSPACE_ID, USER_ID),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceEvidenceError);
  });
});
