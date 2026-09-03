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
const BOUND_AT = '2026-09-04T01:00:00.000Z';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    credential_binding_id: BINDING_ID,
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    installed_by_user_id: USER_ID,
    credential_name: 'webhook.signing',
    secret_reference: 'kms://life-os/plugin/opaque-reference-001',
    credential_status: 'active',
    bound_at: BOUND_AT,
    revoked_at: null,
    ...overrides,
  };
}

function clientFor(result: unknown): PluginCredentialSqlClient {
  return {
    async query<Row>(): Promise<PluginCredentialSqlResult<Row>> {
      return result as PluginCredentialSqlResult<Row>;
    },
  };
}

async function read(result: unknown): Promise<unknown> {
  return new PostgresPluginCredentialBindingStore(clientFor(result)).findById(
    BINDING_ID,
    WORKSPACE_ID,
    USER_ID,
  );
}

describe('PostgresPluginCredentialBindingStore durable evidence coverage', () => {
  it('accepts canonical string timestamp evidence without rewriting it', async () => {
    await expect(read({ rows: [row()], rowCount: 1 })).resolves.toMatchObject({
      credentialBindingId: BINDING_ID,
      boundAt: BOUND_AT,
      status: 'active',
      revokedAt: null,
    });
  });

  it.each([
    ['undefined result', undefined],
    ['primitive result', 'invalid'],
    ['non-array rows', { rows: {}, rowCount: 0 }],
    ['string row count', { rows: [], rowCount: '0' }],
    ['fractional row count', { rows: [], rowCount: 0.5 }],
    ['primitive row', { rows: ['invalid'], rowCount: 1 }],
    ['array row', { rows: [[]], rowCount: 1 }],
  ])('rejects %s with the bounded evidence error', async (_label, result) => {
    await expect(read(result)).rejects.toBeInstanceOf(
      PluginCredentialPersistenceEvidenceError,
    );
  });

  it.each([
    ['invalid UUID', row({ credential_binding_id: 'not-a-uuid' })],
    ['invalid credential name', row({ credential_name: 'Webhook Signing' })],
    ['non-instant timestamp type', row({ bound_at: 123 })],
    ['non-canonical instant shape', row({ bound_at: '2026-09-04T01:00:00Z' })],
    ['calendar-normalized instant', row({ bound_at: '2026-02-30T01:00:00.000Z' })],
    ['invalid status', row({ credential_status: 'disabled' })],
    [
      'active row with revocation timestamp',
      row({ revoked_at: '2026-09-04T02:00:00.000Z' }),
    ],
    ['revoked row without timestamp', row({ credential_status: 'revoked' })],
    [
      'revocation before binding',
      row({
        credential_status: 'revoked',
        revoked_at: '2026-09-04T00:30:00.000Z',
      }),
    ],
  ])('rejects %s as corrupted durable evidence', async (_label, evidence) => {
    await expect(read({ rows: [evidence], rowCount: 1 })).rejects.toBeInstanceOf(
      PluginCredentialPersistenceEvidenceError,
    );
  });
});
