import { describe, expect, it } from 'vitest';
import type { IdentityProvider, ProvisionedAccount } from './identity-domain';
import {
  PostgresIdentityRepository,
  type SqlTransaction,
  type TransactionalSqlClient,
} from './postgres-identity-repository';
import type { SqlQueryResult } from './postgres-security-repositories';

const USER_ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const EXTERNAL_IDENTITY_ID = '22222222-2222-4222-8222-222222222222';
const IDENTITY_WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = '2026-08-03T03:00:00.000Z';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

type QueryHandler = (
  queryText: string,
  queryValues: readonly unknown[],
) => SqlQueryResult<unknown> | Promise<SqlQueryResult<unknown>>;

function emptyResult(rowCount = 0): SqlQueryResult<unknown> {
  return { rows: [], rowCount };
}

class RecordingTransaction implements SqlTransaction {
  readonly queryCalls: QueryCall[] = [];
  released = false;

  constructor(private readonly queryHandler: QueryHandler) {}

  async query<Row>(
    queryText: string,
    queryValues: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.queryCalls.push({ text: queryText, values: queryValues });
    return (await this.queryHandler(queryText, queryValues)) as SqlQueryResult<Row>;
  }

  release(): void {
    this.released = true;
  }
}

class RecordingDatabase implements TransactionalSqlClient {
  readonly queryCalls: QueryCall[] = [];
  connectCalls = 0;

  constructor(
    readonly recordingTransaction: RecordingTransaction,
    private readonly queryHandler: QueryHandler = () => emptyResult(),
  ) {}

  async query<Row>(
    queryText: string,
    queryValues: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    this.queryCalls.push({ text: queryText, values: queryValues });
    return (await this.queryHandler(queryText, queryValues)) as SqlQueryResult<Row>;
  }

  async connect(): Promise<SqlTransaction> {
    this.connectCalls += 1;
    return this.recordingTransaction;
  }
}

function accountFixture(provider: IdentityProvider = 'github'): ProvisionedAccount {
  return {
    user: {
      id: USER_ACCOUNT_ID,
      displayName: 'Example User',
      createdAt: CREATED_AT,
    },
    externalIdentity: {
      id: EXTERNAL_IDENTITY_ID,
      userId: USER_ACCOUNT_ID,
      provider,
      providerSubject: 'provider-subject-123',
      createdAt: CREATED_AT,
    },
    workspace: {
      id: IDENTITY_WORKSPACE_ID,
      ownerUserId: USER_ACCOUNT_ID,
      name: "Example User's workspace",
      kind: 'personal',
      createdAt: CREATED_AT,
    },
  };
}

function accountRow(
  account: ProvisionedAccount = accountFixture(),
): Record<string, unknown> {
  return {
    user_account_id: account.user.id,
    display_name: account.user.displayName,
    user_created_at: new Date(account.user.createdAt),
    external_identity_id: account.externalIdentity.id,
    external_identity_user_account_id: account.externalIdentity.userId,
    identity_provider: account.externalIdentity.provider,
    provider_subject: account.externalIdentity.providerSubject,
    external_identity_created_at: new Date(account.externalIdentity.createdAt),
    identity_workspace_id: account.workspace.id,
    workspace_owner_user_account_id: account.workspace.ownerUserId,
    workspace_name: account.workspace.name,
    workspace_kind: account.workspace.kind,
    workspace_created_at: new Date(account.workspace.createdAt),
  };
}

describe('PostgresIdentityRepository', () => {
  it('loads a stable application aggregate from semantically named persistence', async () => {
    const recordingTransaction = new RecordingTransaction(() => emptyResult());
    const recordingDatabase = new RecordingDatabase(recordingTransaction, () => ({
      rows: [accountRow()],
      rowCount: 1,
    }));
    const repository = new PostgresIdentityRepository(recordingDatabase);

    await expect(
      repository.findByExternalIdentity('github', 'provider-subject-123'),
    ).resolves.toEqual(accountFixture());

    const query = recordingDatabase.queryCalls[0];
    expect(query?.text).toContain('JOIN identity.user_accounts');
    expect(query?.text).toContain('LEFT JOIN identity.identity_workspaces');
    expect(query?.text).toContain('identity_provider');
    expect(query?.values).toEqual(['github', 'provider-subject-123']);
    expect(query?.text).not.toContain('provider-subject-123');
  });

  it('serializes first-sign-in provisioning and maps stable fields to semantic columns', async () => {
    const transaction = new RecordingTransaction((queryText) => {
      if (queryText.includes('FROM identity.external_identities')) {
        return emptyResult();
      }
      return emptyResult(1);
    });
    const database = new RecordingDatabase(transaction);
    const repository = new PostgresIdentityRepository(database);

    await expect(repository.save(accountFixture())).resolves.toEqual(
      accountFixture(),
    );

    expect(database.connectCalls).toBe(1);
    expect(transaction.queryCalls[0]?.text).toBe('BEGIN');
    expect(transaction.queryCalls[1]?.text).toContain('pg_advisory_xact_lock');
    expect(transaction.queryCalls[1]?.values).toEqual([
      'github:provider-subject-123',
    ]);
    expect(
      transaction.queryCalls.some((call) =>
        call.text.includes('INSERT INTO identity.user_accounts'),
      ),
    ).toBe(true);
    expect(
      transaction.queryCalls.some((call) =>
        call.text.includes('INSERT INTO identity.identity_workspaces'),
      ),
    ).toBe(true);
    expect(transaction.queryCalls.at(-1)?.text).toBe('COMMIT');
    expect(transaction.released).toBe(true);

    const externalIdentityInsert = transaction.queryCalls.find((call) =>
      call.text.includes('INSERT INTO identity.external_identities'),
    );
    expect(externalIdentityInsert?.text).toContain('external_identity_id');
    expect(externalIdentityInsert?.text).toContain('user_account_id');
    expect(externalIdentityInsert?.text).toContain('identity_provider');
    expect(externalIdentityInsert?.values).toEqual([
      EXTERNAL_IDENTITY_ID,
      USER_ACCOUNT_ID,
      'github',
      'provider-subject-123',
      CREATED_AT,
    ]);
  });

  it('returns the transaction winner when another callback provisioned first', async () => {
    const existing = accountFixture('google');
    const proposed: ProvisionedAccount = {
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
    };
    const transaction = new RecordingTransaction((queryText) => {
      if (queryText.includes('FROM identity.external_identities')) {
        return { rows: [accountRow(existing)], rowCount: 1 };
      }
      return emptyResult();
    });
    const repository = new PostgresIdentityRepository(
      new RecordingDatabase(transaction),
    );

    await expect(repository.save(proposed)).resolves.toEqual(existing);
    expect(
      transaction.queryCalls.some((call) => call.text.includes('INSERT INTO')),
    ).toBe(false);
    expect(transaction.queryCalls.at(-1)?.text).toBe('COMMIT');
    expect(transaction.released).toBe(true);
  });

  it('rolls back and releases the connection when provisioning fails', async () => {
    const transaction = new RecordingTransaction((queryText) => {
      if (queryText.includes('FROM identity.external_identities')) {
        return emptyResult();
      }
      if (queryText.includes('INSERT INTO identity.external_identities')) {
        throw new Error('database write failed');
      }
      return emptyResult(1);
    });
    const repository = new PostgresIdentityRepository(
      new RecordingDatabase(transaction),
    );

    await expect(repository.save(accountFixture())).rejects.toThrowError(
      'database write failed',
    );
    expect(transaction.queryCalls.some((call) => call.text === 'ROLLBACK')).toBe(
      true,
    );
    expect(
      transaction.queryCalls.some((call) =>
        call.text.includes('INSERT INTO identity.identity_workspaces'),
      ),
    ).toBe(false);
    expect(transaction.released).toBe(true);
  });

  it('fails closed when persisted ownership or identifiers are malformed', async () => {
    const malformed = {
      ...accountRow(),
      workspace_owner_user_account_id: '44444444-4444-4444-8444-444444444444',
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
