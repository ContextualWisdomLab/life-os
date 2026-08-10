import { describe, expect, it } from 'vitest';
import type { PluginCredentialBindingRecord } from './plugin-credential';
import {
  PluginCredentialPersistenceEvidenceError,
  PluginCredentialPersistenceValidationError,
  PostgresPluginCredentialBindingStore,
  type PluginCredentialSqlClient,
  type PluginCredentialSqlResult,
} from './plugin-credential-repository';

const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BOUND_AT = '2026-08-10T07:00:00.000Z';
const REVOKED_AT = '2026-08-10T08:00:00.000Z';

interface CredentialRow {
  credential_binding_id: unknown;
  installation_id: unknown;
  workspace_id: unknown;
  installed_by_user_id: unknown;
  credential_name: unknown;
  secret_reference: unknown;
  credential_status: unknown;
  bound_at: unknown;
  revoked_at: unknown;
}

function activeRecord(): PluginCredentialBindingRecord {
  return Object.freeze({
    credentialBindingId: BINDING_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    credentialName: 'webhook.signing',
    secretReference: 'kms://life-os/plugin/opaque-reference-001',
    status: 'active',
    boundAt: BOUND_AT,
    revokedAt: null,
  });
}

function row(
  overrides: Partial<CredentialRow> = {},
): CredentialRow {
  return {
    credential_binding_id: BINDING_ID,
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    installed_by_user_id: USER_ID,
    credential_name: 'webhook.signing',
    secret_reference: 'kms://life-os/plugin/opaque-reference-001',
    credential_status: 'active',
    bound_at: new Date(BOUND_AT),
    revoked_at: null,
    ...overrides,
  };
}

class QueueClient implements PluginCredentialSqlClient {
  readonly calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  constructor(private readonly results: Array<PluginCredentialSqlResult<CredentialRow>>) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PluginCredentialSqlResult<Row>> {
    this.calls.push({ text, values });
    const result = this.results.shift();
    if (!result) throw new Error('unexpected SQL query');
    return result as PluginCredentialSqlResult<Row>;
  }
}

describe('PostgresPluginCredentialBindingStore', () => {
  it('creates metadata with fixed parameterized SQL and exact installer authority', async () => {
    const client = new QueueClient([{ rows: [row()], rowCount: 1 }]);
    const store = new PostgresPluginCredentialBindingStore(client);

    await expect(store.createIfAbsent(activeRecord())).resolves.toEqual(activeRecord());
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain('ON CONFLICT (credential_binding_id) DO NOTHING');
    expect(client.calls[0]?.text).toContain('$1::uuid');
    expect(client.calls[0]?.values).toEqual([
      BINDING_ID,
      INSTALLATION_ID,
      WORKSPACE_ID,
      USER_ID,
      'webhook.signing',
      'kms://life-os/plugin/opaque-reference-001',
      BOUND_AT,
    ]);
    expect(client.calls[0]?.text).not.toContain('plugin-secret-value');
  });

  it('reads only through binding, workspace, and installing-user predicates', async () => {
    const client = new QueueClient([{ rows: [row()], rowCount: 1 }]);
    const store = new PostgresPluginCredentialBindingStore(client);

    await expect(store.findById(BINDING_ID, WORKSPACE_ID, USER_ID)).resolves.toEqual(
      activeRecord(),
    );
    expect(client.calls[0]?.text).toContain('credential_binding_id = $1::uuid');
    expect(client.calls[0]?.text).toContain('workspace_id = $2::uuid');
    expect(client.calls[0]?.text).toContain('installed_by_user_id = $3::uuid');
    expect(client.calls[0]?.values).toEqual([BINDING_ID, WORKSPACE_ID, USER_ID]);
  });

  it('rejects malformed authority before any SQL executes', async () => {
    const client = new QueueClient([]);
    const store = new PostgresPluginCredentialBindingStore(client);

    await expect(store.findById('not-a-uuid', WORKSPACE_ID, USER_ID)).rejects.toBeInstanceOf(
      PluginCredentialPersistenceValidationError,
    );
    expect(client.calls).toHaveLength(0);
  });

  it('fails closed on corrupted durable evidence', async () => {
    const client = new QueueClient([
      { rows: [row({ secret_reference: 'plaintext secret with spaces' })], rowCount: 1 },
    ]);
    const store = new PostgresPluginCredentialBindingStore(client);

    await expect(store.findById(BINDING_ID, WORKSPACE_ID, USER_ID)).rejects.toBeInstanceOf(
      PluginCredentialPersistenceEvidenceError,
    );
  });

  it('revokes only exact active installer authority and returns a scoped replay', async () => {
    const revoked = row({ credential_status: 'revoked', revoked_at: new Date(REVOKED_AT) });
    const client = new QueueClient([{ rows: [revoked], rowCount: 1 }]);
    const store = new PostgresPluginCredentialBindingStore(client);

    await expect(
      store.revokeActive({
        credentialBindingId: BINDING_ID,
        workspaceId: WORKSPACE_ID,
        installedByUserId: USER_ID,
        revokedAt: REVOKED_AT,
      }),
    ).resolves.toMatchObject({ status: 'revoked', revokedAt: REVOKED_AT });
    expect(client.calls[0]?.text).toContain("credential_status = 'active'");
    expect(client.calls[0]?.text).toContain('workspace_id = $2::uuid');
    expect(client.calls[0]?.text).toContain('installed_by_user_id = $3::uuid');
    expect(client.calls[0]?.values).toEqual([
      BINDING_ID,
      WORKSPACE_ID,
      USER_ID,
      REVOKED_AT,
    ]);
  });
});
