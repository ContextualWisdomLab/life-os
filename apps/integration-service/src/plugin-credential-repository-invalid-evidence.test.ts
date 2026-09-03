import { describe, expect, it } from 'vitest';
import {
  PluginCredentialPersistenceEvidenceError,
  PostgresPluginCredentialBindingStore,
  type PluginCredentialSqlClient,
  type PluginCredentialSqlResult,
} from './plugin-credential-repository';

const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function durableRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    credential_binding_id: BINDING_ID,
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    installed_by_user_id: USER_ID,
    credential_name: 'webhook.signing',
    secret_reference: 'kms://life-os/plugin/opaque-reference-001',
    credential_status: 'active',
    bound_at: new Date('2026-09-04T01:00:00.000Z'),
    revoked_at: null,
    ...overrides,
  };
}

class EvidenceClient implements PluginCredentialSqlClient {
  constructor(private readonly evidence: unknown) {}

  async query<Row>(): Promise<PluginCredentialSqlResult<Row>> {
    return {
      rows: [this.evidence as Row],
      rowCount: 1,
    };
  }
}

async function expectEvidenceFailure(evidence: unknown): Promise<void> {
  const store = new PostgresPluginCredentialBindingStore(new EvidenceClient(evidence));
  await expect(
    store.findById(BINDING_ID, WORKSPACE_ID, USER_ID),
  ).rejects.toBeInstanceOf(PluginCredentialPersistenceEvidenceError);
}

describe('PostgresPluginCredentialBindingStore malformed durable evidence', () => {
  it.each([
    ['bound_at', durableRow({ bound_at: new Date(Number.NaN) })],
    [
      'revoked_at',
      durableRow({
        credential_status: 'revoked',
        revoked_at: new Date(Number.NaN),
      }),
    ],
  ])('maps invalid %s Date evidence to the bounded persistence error', async (_field, evidence) => {
    await expectEvidenceFailure(evidence);
  });

  it.each([null, undefined, []])(
    'maps non-record row evidence %p to the bounded persistence error',
    async (evidence) => {
      await expectEvidenceFailure(evidence);
    },
  );

  it('rejects non-canonical persisted UUID casing instead of silently normalizing authority', async () => {
    await expectEvidenceFailure(
      durableRow({ credential_binding_id: BINDING_ID.toUpperCase() }),
    );
  });
});
