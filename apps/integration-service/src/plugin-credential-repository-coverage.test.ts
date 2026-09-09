import { describe, expect, it } from 'vitest';
import type {
  PluginCredentialBindingRecord,
  RevokePluginCredential,
} from './plugin-credential';
import {
  PluginCredentialPersistenceEvidenceError,
  PluginCredentialPersistenceValidationError,
  PostgresPluginCredentialBindingStore,
  type PluginCredentialSqlClient,
  type PluginCredentialSqlResult,
} from './plugin-credential-repository';

const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_BINDING_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INSTALLATION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_WORKSPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const BOUND_AT = '2026-09-09T08:00:00.000Z';
const REVOKED_AT = '2026-09-09T09:00:00.000Z';
const SECRET_REFERENCE = 'kms://life-os/plugin/opaque-reference-coverage';

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

function activeRecord(
  overrides: Partial<PluginCredentialBindingRecord> = {},
): PluginCredentialBindingRecord {
  return {
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
  };
}

function revokeInput(
  overrides: Partial<RevokePluginCredential> = {},
): RevokePluginCredential {
  return {
    credentialBindingId: BINDING_ID,
    workspaceId: WORKSPACE_ID,
    installedByUserId: USER_ID,
    revokedAt: REVOKED_AT,
    ...overrides,
  };
}

function row(overrides: Partial<CredentialRow> = {}): CredentialRow {
  return {
    credential_binding_id: BINDING_ID,
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    installed_by_user_id: USER_ID,
    credential_name: 'webhook.signing',
    secret_reference: SECRET_REFERENCE,
    credential_status: 'active',
    bound_at: new Date(BOUND_AT),
    revoked_at: null,
    ...overrides,
  };
}

function revokedRow(overrides: Partial<CredentialRow> = {}): CredentialRow {
  return row({
    credential_status: 'revoked',
    revoked_at: new Date(REVOKED_AT),
    ...overrides,
  });
}

function zeroRows(): PluginCredentialSqlResult<CredentialRow> {
  return { rows: [], rowCount: 0 };
}

class QueueClient implements PluginCredentialSqlClient {
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[] | undefined;
  }> = [];

  constructor(
    private readonly results: Array<PluginCredentialSqlResult<CredentialRow>>,
  ) {}

  async query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginCredentialSqlResult<Row>> {
    this.calls.push({ text, values });
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error('unexpected SQL query');
    }
    return result as PluginCredentialSqlResult<Row>;
  }
}

describe('PostgresPluginCredentialBindingStore coverage boundaries', () => {
  it('covers scoped create replay success and missing durable winner', async () => {
    const replayClient = new QueueClient([
      zeroRows(),
      { rows: [row()], rowCount: 1 },
    ]);
    const replayStore = new PostgresPluginCredentialBindingStore(replayClient);

    await expect(replayStore.createIfAbsent(activeRecord())).resolves.toEqual(
      activeRecord(),
    );
    expect(replayClient.calls).toHaveLength(2);
    expect(replayClient.calls[1]?.text).toContain('LIMIT 2');

    const missingStore = new PostgresPluginCredentialBindingStore(
      new QueueClient([zeroRows(), zeroRows()]),
    );
    await expect(missingStore.createIfAbsent(activeRecord())).rejects.toEqual(
      new PluginCredentialPersistenceEvidenceError(),
    );
  });

  it('covers empty and scope-mismatched reads without broadening authority', async () => {
    const emptyStore = new PostgresPluginCredentialBindingStore(
      new QueueClient([zeroRows()]),
    );
    await expect(
      emptyStore.findById(BINDING_ID, WORKSPACE_ID, USER_ID),
    ).resolves.toBeUndefined();

    const mismatchedStore = new PostgresPluginCredentialBindingStore(
      new QueueClient([
        {
          rows: [row({ credential_binding_id: OTHER_BINDING_ID })],
          rowCount: 1,
        },
      ]),
    );
    await expect(
      mismatchedStore.findById(BINDING_ID, WORKSPACE_ID, USER_ID),
    ).rejects.toEqual(new PluginCredentialPersistenceEvidenceError());
  });

  it('covers revoked replay, absent revocation and mismatched revoked evidence', async () => {
    const replayStore = new PostgresPluginCredentialBindingStore(
      new QueueClient([
        zeroRows(),
        { rows: [revokedRow()], rowCount: 1 },
      ]),
    );
    await expect(replayStore.revokeActive(revokeInput())).resolves.toMatchObject({
      status: 'revoked',
      revokedAt: REVOKED_AT,
    });

    const absentStore = new PostgresPluginCredentialBindingStore(
      new QueueClient([zeroRows(), zeroRows()]),
    );
    await expect(absentStore.revokeActive(revokeInput())).resolves.toBeUndefined();

    const mismatchedStore = new PostgresPluginCredentialBindingStore(
      new QueueClient([
        {
          rows: [revokedRow({ workspace_id: OTHER_WORKSPACE_ID })],
          rowCount: 1,
        },
      ]),
    );
    await expect(mismatchedStore.revokeActive(revokeInput())).rejects.toEqual(
      new PluginCredentialPersistenceEvidenceError(),
    );
  });

  it('rejects impossible input instants before persistence access', async () => {
    const invalidInstants = [
      '2026-13-01T08:00:00.000Z',
      '2026-02-30T08:00:00.000Z',
    ];

    for (const boundAt of invalidInstants) {
      const client = new QueueClient([]);
      const store = new PostgresPluginCredentialBindingStore(client);
      await expect(
        store.createIfAbsent(activeRecord({ boundAt })),
      ).rejects.toEqual(new PluginCredentialPersistenceValidationError());
      expect(client.calls).toEqual([]);
    }

    for (const revokedAt of invalidInstants) {
      const client = new QueueClient([]);
      const store = new PostgresPluginCredentialBindingStore(client);
      await expect(
        store.revokeActive(revokeInput({ revokedAt })),
      ).rejects.toEqual(new PluginCredentialPersistenceValidationError());
      expect(client.calls).toEqual([]);
    }
  });

  it('rejects malformed result and durable field evidence at the repository boundary', async () => {
    const malformedResults: Array<PluginCredentialSqlResult<CredentialRow>> = [
      { rows: [undefined as unknown as CredentialRow], rowCount: 1 },
      {
        rows: [row({ bound_at: new Date(Number.NaN) })],
        rowCount: 1,
      },
      {
        rows: [row({ bound_at: '2026-02-30T08:00:00.000Z' })],
        rowCount: 1,
      },
      {
        rows: [row({ credential_name: 'Webhook.Signing' })],
        rowCount: 1,
      },
    ];

    for (const result of malformedResults) {
      const store = new PostgresPluginCredentialBindingStore(
        new QueueClient([result]),
      );
      await expect(
        store.findById(BINDING_ID, WORKSPACE_ID, USER_ID),
      ).rejects.toEqual(new PluginCredentialPersistenceEvidenceError());
    }
  });
});
