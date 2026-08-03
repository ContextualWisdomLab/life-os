import { describe, expect, it } from 'vitest';
import type { IdentityProvider, ProvisionedAccount } from './identity-domain';
import {
  PostgresIdentityRepository,
  type SqlTransaction,
  type TransactionalSqlClient,
} from './postgres-identity-repository';
import type { SqlQueryResult } from './postgres-security-repositories';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const EXTERNAL_IDENTITY_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = '2026-08-03T03:00:00.000Z';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

type QueryHandler = (
  text: string,
  values: readonly unknown[],
) => SqlQueryResult<unknown> | Promise<SqlQueryResult<unknown>>;

function emptyResult(rowCount = 0): SqlQueryResult<unknown> {
  return { rows: [], rowCount };
}

class RecordingTransaction implements SqlTransaction {
  readonly calls: QueryCall[] = [];
  released = false;

  constructor(private readonly handler: QueryHandler) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (await this.handler(text, values)) as SqlQueryResult<Row>;
  }

  release(): void {
    this.released = true;
  }
}

class RecordingDatabase implements TransactionalSqlClient {
  readonly calls: QueryCall[] = [];
  connectCalls = 0;

  constructor(
    readonly transaction: RecordingTransaction,
    private readonly handler: QueryHandler = () => emptyResult(),
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    return (await this.handler(text, values)) as SqlQueryResult<Row>;
  }

  async connect(): Promise<SqlTransaction> {
    this.connectCalls += 1;
    return this.transaction;
  }
}

function account(provider: IdentityProvider = 'github'): ProvisionedAccount {
  return {
    user: {
      id: USER_ID,
      displayName: 'Example User',
      createdAt: CREATED_AT,
    },
    externalIdentity: {
      id: EXTERNAL_IDENTITY_ID,
      userId: USER_ID,
      provider,
      providerSubject: 'provider-subject-123',
      createdAt: CREATED_AT,
    },
    workspace: {
      id: WORKSPACE_ID,
      ownerUserId: USER_ID,
      name: "Example User's workspace",
      kind: 'personal',
      createdAt: CREATED_AT,
    },
  };
}

function accountRow(value: ProvisionedAccount = account()): Record<string, unknown> {
  return {
    user_id: value.user.id,
    display_name: value.user.displayName,
    user_created_at: new Date(value.user.createdAt),
    external_identity_id: value.externalIdentity.id,
    external_identity_user_id: value.externalIdentity.userId,
    provider: value.externalIdentity.provider,
    provider_subject: value.externalIdentity.providerSubject,
    external_identity_created_at: new Date(value.externalIdentity.createdAt),
    workspace_id: value.workspace.id,
    workspace_owner_user_id: value.workspace.ownerUserId,
    workspace_name: value.workspace.name,
    workspace_kind: value.workspace.kind,
    workspace_created_at: new Date(value.workspace.createdAt),
  };
}

describe('PostgresIdentityRepository', () => {
  it('loads and validates a complete tenant-safe identity aggregate', async () => {
    const transaction = new RecordingTransaction(() => emptyResult());
    const database = new RecordingDatabase(transaction, () => ({
      rows: [accountRow()],
      rowCount: 1,
    }));
    const repository = new PostgresIdentityRepository(database);

    await expect(
      repository.findByExternalIdentity('github', 'provider-subject-123'),
    ).resolves.toEqual(account());

    expect(database.calls).toHaveLength(1);
    expect(database.calls[0]?.text).toContain('LEFT JOIN identity.workspaces');
    expect(database.calls[0]?.values).toEqual(['github', 'provider-subject-123']);
    expect(database.calls[0]?.text).not.toContain('provider-subject-123');
  });

  it('serializes first-sign-in provisioning and inserts one complete account', async () => {
    const transaction = new RecordingTransaction((text) => {
      if (text.includes('FROM identity.external_identities')) {
        return emptyResult();
      }
      return emptyResult(1);
    });
    const database = new RecordingDatabase(transaction);
    const repository = new PostgresIdentityRepository(database);

    await expect(repository.save(account())).resolves.toEqual(account());

    expect(database.connectCalls).toBe(1);
    expect(transaction.calls[0]?.text).toBe('BEGIN');
    expect(transaction.calls[1]?.text).toContain('pg_advisory_xact_lock');
    expect(transaction.calls[1]?.values).toEqual(['github:provider-subject-123']);
    expect(transaction.calls.some((call) => call.text.includes('INSERT INTO identity.users'))).toBe(
      true,
    );
    expect(
      transaction.calls.some((call) => call.text.includes('INSERT INTO identity.external_identities')),
    ).toBe(true);
    expect(
      transaction.calls.some((call) => call.text.includes('INSERT INTO identity.workspaces')),
    ).toBe(true);
    expect(transaction.calls.at(-1)?.text).toBe('COMMIT');
    expect(transaction.released).toBe(true);

    const externalIdentityInsert = transaction.calls.find((call) =>
      call.text.includes('INSERT INTO identity.external_identities'),
    );
    expect(externalIdentityInsert?.values).toEqual([
      EXTERNAL_IDENTITY_ID,
      USER_ID,
      'github',
      'provider-subject-123',
      CREATED_AT,
    ]);
    expect(externalIdentityInsert?.text).not.toContain('provider-subject-123');
  });

  it('returns the transaction winner when another callback provisioned first', async () => {
    const existing = account('google');
    const proposed = {
      ...existing,
      user: { ...existing.user, id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      externalIdentity: {
        ...existing.externalIdentity,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      workspace: {
        ...existing.workspace,
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ownerUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    } satisfies ProvisionedAccount;
    const transaction = new RecordingTransaction((text) => {
      if (text.includes('FROM identity.external_identities')) {
        return { rows: [accountRow(existing)], rowCount: 1 };
      }
      return emptyResult();
    });
    const repository = new PostgresIdentityRepository(new RecordingDatabase(transaction));

    await expect(repository.save(proposed)).resolves.toEqual(existing);

    expect(transaction.calls.some((call) => call.text.includes('INSERT INTO'))).toBe(false);
    expect(transaction.calls.at(-1)?.text).toBe('COMMIT');
    expect(transaction.released).toBe(true);
  });

  it('rolls back all rows and releases the connection when provisioning fails', async () => {
    const transaction = new RecordingTransaction((text) => {
      if (text.includes('FROM identity.external_identities')) {
        return emptyResult();
      }
      if (text.includes('INSERT INTO identity.external_identities')) {
        throw new Error('database write failed');
      }
      return emptyResult(1);
    });
    const repository = new PostgresIdentityRepository(new RecordingDatabase(transaction));

    await expect(repository.save(account())).rejects.toThrowError('database write failed');

    expect(transaction.calls.some((call) => call.text === 'ROLLBACK')).toBe(true);
    expect(
      transaction.calls.some((call) => call.text.includes('INSERT INTO identity.workspaces')),
    ).toBe(false);
    expect(transaction.released).toBe(true);
  });

  it('fails closed when persisted ownership or identifiers are malformed', async () => {
    const malformed = {
      ...accountRow(),
      workspace_owner_user_id: '44444444-4444-4444-8444-444444444444',
    };
    const transaction = new RecordingTransaction(() => emptyResult());
    const repository = new PostgresIdentityRepository(
      new RecordingDatabase(transaction, () => ({ rows: [malformed], rowCount: 1 })),
    );

    await expect(
      repository.findByExternalIdentity('github', 'provider-subject-123'),
    ).rejects.toThrowError('Stored identity account is invalid');
  });
});
