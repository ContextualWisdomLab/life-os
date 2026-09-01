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

function accountFixture(
  identityProvider: IdentityProvider = 'github',
): ProvisionedAccount {
  return {
    userAccount: {
      userAccountId: USER_ACCOUNT_ID,
      displayName: 'Example User',
      createdAt: CREATED_AT,
    },
    externalIdentity: {
      externalIdentityId: EXTERNAL_IDENTITY_ID,
      userAccountId: USER_ACCOUNT_ID,
      identityProvider,
      providerSubject: 'provider-subject-123',
      createdAt: CREATED_AT,
    },
    identityWorkspace: {
      identityWorkspaceId: IDENTITY_WORKSPACE_ID,
      ownerUserAccountId: USER_ACCOUNT_ID,
      workspaceName: "Example User's workspace",
      workspaceKind: 'personal',
      createdAt: CREATED_AT,
    },
  };
}

function accountRow(
  provisionedAccount: ProvisionedAccount = accountFixture(),
): Record<string, unknown> {
  return {
    user_account_id: provisionedAccount.userAccount.userAccountId,
    display_name: provisionedAccount.userAccount.displayName,
    user_created_at: new Date(provisionedAccount.userAccount.createdAt),
    external_identity_id: provisionedAccount.externalIdentity.externalIdentityId,
    external_identity_user_account_id:
      provisionedAccount.externalIdentity.userAccountId,
    identity_provider: provisionedAccount.externalIdentity.identityProvider,
    provider_subject: provisionedAccount.externalIdentity.providerSubject,
    external_identity_created_at: new Date(
      provisionedAccount.externalIdentity.createdAt,
    ),
    identity_workspace_id:
      provisionedAccount.identityWorkspace.identityWorkspaceId,
    workspace_owner_user_account_id:
      provisionedAccount.identityWorkspace.ownerUserAccountId,
    workspace_name: provisionedAccount.identityWorkspace.workspaceName,
    workspace_kind: provisionedAccount.identityWorkspace.workspaceKind,
    workspace_created_at: new Date(provisionedAccount.identityWorkspace.createdAt),
  };
}

describe('PostgresIdentityRepository', () => {
  it('loads and validates a complete tenant-safe identity aggregate', async () => {
    const recordingTransaction = new RecordingTransaction(() => emptyResult());
    const recordingDatabase = new RecordingDatabase(recordingTransaction, () => ({
      rows: [accountRow()],
      rowCount: 1,
    }));
    const identityRepository = new PostgresIdentityRepository(recordingDatabase);

    await expect(
      identityRepository.findByExternalIdentity('github', 'provider-subject-123'),
    ).resolves.toEqual(accountFixture());

    expect(recordingDatabase.queryCalls).toHaveLength(1);
    expect(recordingDatabase.queryCalls[0]?.text).toContain(
      'LEFT JOIN identity.identity_workspaces',
    );
    expect(recordingDatabase.queryCalls[0]?.text).toContain(
      'JOIN identity.user_accounts',
    );
    expect(recordingDatabase.queryCalls[0]?.values).toEqual([
      'github',
      'provider-subject-123',
    ]);
    expect(recordingDatabase.queryCalls[0]?.text).not.toContain(
      'provider-subject-123',
    );
  });

  it('serializes first-sign-in provisioning and inserts one complete account', async () => {
    const recordingTransaction = new RecordingTransaction((queryText) => {
      if (queryText.includes('FROM identity.external_identities')) {
        return emptyResult();
      }
      return emptyResult(1);
    });
    const recordingDatabase = new RecordingDatabase(recordingTransaction);
    const identityRepository = new PostgresIdentityRepository(recordingDatabase);

    await expect(identityRepository.save(accountFixture())).resolves.toEqual(
      accountFixture(),
    );

    expect(recordingDatabase.connectCalls).toBe(1);
    expect(recordingTransaction.queryCalls[0]?.text).toBe('BEGIN');
    expect(recordingTransaction.queryCalls[1]?.text).toContain(
      'pg_advisory_xact_lock',
    );
    expect(recordingTransaction.queryCalls[1]?.values).toEqual([
      'github:provider-subject-123',
    ]);
    expect(
      recordingTransaction.queryCalls.some((queryCall) =>
        queryCall.text.includes('INSERT INTO identity.user_accounts'),
      ),
    ).toBe(true);
    expect(
      recordingTransaction.queryCalls.some((queryCall) =>
        queryCall.text.includes('INSERT INTO identity.external_identities'),
      ),
    ).toBe(true);
    expect(
      recordingTransaction.queryCalls.some((queryCall) =>
        queryCall.text.includes('INSERT INTO identity.identity_workspaces'),
      ),
    ).toBe(true);
    expect(recordingTransaction.queryCalls.at(-1)?.text).toBe('COMMIT');
    expect(recordingTransaction.released).toBe(true);

    const externalIdentityInsert = recordingTransaction.queryCalls.find(
      (queryCall) =>
        queryCall.text.includes('INSERT INTO identity.external_identities'),
    );
    expect(externalIdentityInsert?.values).toEqual([
      EXTERNAL_IDENTITY_ID,
      USER_ACCOUNT_ID,
      'github',
      'provider-subject-123',
      CREATED_AT,
    ]);
    expect(externalIdentityInsert?.text).toContain('identity_provider');
    expect(externalIdentityInsert?.text).not.toContain('provider-subject-123');
  });

  it('returns the transaction winner when another callback provisioned first', async () => {
    const existingAccount = accountFixture('google');
    const proposedAccount = {
      ...existingAccount,
      userAccount: {
        ...existingAccount.userAccount,
        userAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      externalIdentity: {
        ...existingAccount.externalIdentity,
        externalIdentityId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        userAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      identityWorkspace: {
        ...existingAccount.identityWorkspace,
        identityWorkspaceId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ownerUserAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    } satisfies ProvisionedAccount;
    const recordingTransaction = new RecordingTransaction((queryText) => {
      if (queryText.includes('FROM identity.external_identities')) {
        return { rows: [accountRow(existingAccount)], rowCount: 1 };
      }
      return emptyResult();
    });
    const identityRepository = new PostgresIdentityRepository(
      new RecordingDatabase(recordingTransaction),
    );

    await expect(identityRepository.save(proposedAccount)).resolves.toEqual(
      existingAccount,
    );

    expect(
      recordingTransaction.queryCalls.some((queryCall) =>
        queryCall.text.includes('INSERT INTO'),
      ),
    ).toBe(false);
    expect(recordingTransaction.queryCalls.at(-1)?.text).toBe('COMMIT');
    expect(recordingTransaction.released).toBe(true);
  });

  it('rolls back all rows and releases the connection when provisioning fails', async () => {
    const recordingTransaction = new RecordingTransaction((queryText) => {
      if (queryText.includes('FROM identity.external_identities')) {
        return emptyResult();
      }
      if (queryText.includes('INSERT INTO identity.external_identities')) {
        throw new Error('database write failed');
      }
      return emptyResult(1);
    });
    const identityRepository = new PostgresIdentityRepository(
      new RecordingDatabase(recordingTransaction),
    );

    await expect(identityRepository.save(accountFixture())).rejects.toThrowError(
      'database write failed',
    );

    expect(
      recordingTransaction.queryCalls.some(
        (queryCall) => queryCall.text === 'ROLLBACK',
      ),
    ).toBe(true);
    expect(
      recordingTransaction.queryCalls.some((queryCall) =>
        queryCall.text.includes('INSERT INTO identity.identity_workspaces'),
      ),
    ).toBe(false);
    expect(recordingTransaction.released).toBe(true);
  });

  it('fails closed when persisted ownership or identifiers are malformed', async () => {
    const malformedAccountRow = {
      ...accountRow(),
      workspace_owner_user_account_id: '44444444-4444-4444-8444-444444444444',
    };
    const recordingTransaction = new RecordingTransaction(() => emptyResult());
    const identityRepository = new PostgresIdentityRepository(
      new RecordingDatabase(recordingTransaction, () => ({
        rows: [malformedAccountRow],
        rowCount: 1,
      })),
    );

    await expect(
      identityRepository.findByExternalIdentity('github', 'provider-subject-123'),
    ).rejects.toThrowError('Stored identity account is invalid');
  });
});
