import type {
  IdentityProvider,
  IdentityRepository,
  ProvisionedAccount,
} from './identity-domain';
import type { SqlClient } from './postgres-security-repositories';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_STORED_ACCOUNT = 'Stored identity account is invalid';

export interface SqlTransaction extends SqlClient {
  release(): void;
}

export interface TransactionalSqlClient extends SqlClient {
  connect(): Promise<SqlTransaction>;
}

interface IdentityAccountRow {
  user_account_id: unknown;
  display_name: unknown;
  user_created_at: unknown;
  external_identity_id: unknown;
  external_identity_user_account_id: unknown;
  identity_provider: unknown;
  provider_subject: unknown;
  external_identity_created_at: unknown;
  identity_workspace_id: unknown;
  workspace_owner_user_account_id: unknown;
  workspace_name: unknown;
  workspace_kind: unknown;
  workspace_created_at: unknown;
}

function requireString(
  stringValue: unknown,
  errorMessage = INVALID_STORED_ACCOUNT,
): string {
  if (typeof stringValue !== 'string' || !stringValue.trim()) {
    throw new Error(errorMessage);
  }
  return stringValue;
}

function requireUuidV4(
  identifierValue: unknown,
  errorMessage = INVALID_STORED_ACCOUNT,
): string {
  const opaqueIdentifier = requireString(identifierValue, errorMessage);
  if (!UUID_V4_PATTERN.test(opaqueIdentifier)) {
    throw new Error(errorMessage);
  }
  return opaqueIdentifier;
}

function requireProvider(providerValue: unknown): IdentityProvider {
  if (providerValue !== 'google' && providerValue !== 'github') {
    throw new Error(INVALID_STORED_ACCOUNT);
  }
  return providerValue;
}

function toIsoString(timestampValue: unknown): string {
  const timestampDate =
    timestampValue instanceof Date
      ? timestampValue
      : new Date(requireString(timestampValue));
  if (!Number.isFinite(timestampDate.getTime())) {
    throw new Error(INVALID_STORED_ACCOUNT);
  }
  return timestampDate.toISOString();
}

function mapAccountRow(accountRow: IdentityAccountRow): ProvisionedAccount {
  const userId = requireUuidV4(accountRow.user_account_id);
  const externalIdentityUserId = requireUuidV4(
    accountRow.external_identity_user_account_id,
  );
  const workspaceOwnerUserId = requireUuidV4(
    accountRow.workspace_owner_user_account_id,
  );
  if (
    externalIdentityUserId !== userId ||
    workspaceOwnerUserId !== userId ||
    accountRow.workspace_kind !== 'personal'
  ) {
    throw new Error(INVALID_STORED_ACCOUNT);
  }

  return {
    user: {
      id: userId,
      displayName: requireString(accountRow.display_name),
      createdAt: toIsoString(accountRow.user_created_at),
    },
    externalIdentity: {
      id: requireUuidV4(accountRow.external_identity_id),
      userId: externalIdentityUserId,
      provider: requireProvider(accountRow.identity_provider),
      providerSubject: requireString(accountRow.provider_subject),
      createdAt: toIsoString(accountRow.external_identity_created_at),
    },
    workspace: {
      id: requireUuidV4(accountRow.identity_workspace_id),
      ownerUserId: workspaceOwnerUserId,
      name: requireString(accountRow.workspace_name),
      kind: 'personal',
      createdAt: toIsoString(accountRow.workspace_created_at),
    },
  };
}

function validateProposedAccount(account: ProvisionedAccount): ProvisionedAccount {
  return mapAccountRow({
    user_account_id: account.user.id,
    display_name: account.user.displayName,
    user_created_at: account.user.createdAt,
    external_identity_id: account.externalIdentity.id,
    external_identity_user_account_id: account.externalIdentity.userId,
    identity_provider: account.externalIdentity.provider,
    provider_subject: account.externalIdentity.providerSubject,
    external_identity_created_at: account.externalIdentity.createdAt,
    identity_workspace_id: account.workspace.id,
    workspace_owner_user_account_id: account.workspace.ownerUserId,
    workspace_name: account.workspace.name,
    workspace_kind: account.workspace.kind,
    workspace_created_at: account.workspace.createdAt,
  });
}

async function findAccount(
  databaseClient: SqlClient,
  provider: IdentityProvider,
  providerSubject: string,
): Promise<ProvisionedAccount | undefined> {
  const queryResult = await databaseClient.query<IdentityAccountRow>(
    `SELECT
       user_accounts.user_account_id,
       user_accounts.display_name,
       user_accounts.created_at AS user_created_at,
       external_identities.external_identity_id,
       external_identities.user_account_id AS external_identity_user_account_id,
       external_identities.identity_provider,
       external_identities.provider_subject,
       external_identities.created_at AS external_identity_created_at,
       identity_workspaces.identity_workspace_id,
       identity_workspaces.owner_user_account_id AS workspace_owner_user_account_id,
       identity_workspaces.workspace_name,
       identity_workspaces.workspace_kind,
       identity_workspaces.created_at AS workspace_created_at
     FROM identity.external_identities
     JOIN identity.user_accounts
       ON identity.user_accounts.user_account_id = external_identities.user_account_id
     LEFT JOIN identity.identity_workspaces
       ON identity.identity_workspaces.owner_user_account_id = user_accounts.user_account_id
      AND identity.identity_workspaces.workspace_kind = 'personal'
     WHERE identity.external_identities.identity_provider = $1
       AND identity.external_identities.provider_subject = $2
     LIMIT 2`,
    [provider, providerSubject],
  );

  if (queryResult.rows.length > 1) {
    throw new Error(INVALID_STORED_ACCOUNT);
  }
  const accountRow = queryResult.rows[0];
  return accountRow ? mapAccountRow(accountRow) : undefined;
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly databaseClient: TransactionalSqlClient) {}

  async findByExternalIdentity(
    provider: IdentityProvider,
    providerSubject: string,
  ): Promise<ProvisionedAccount | undefined> {
    return await findAccount(this.databaseClient, provider, providerSubject);
  }

  async save(accountValue: ProvisionedAccount): Promise<ProvisionedAccount> {
    const account = validateProposedAccount(accountValue);
    const databaseConnection = await this.databaseClient.connect();
    let transactionStarted = false;

    try {
      await databaseConnection.query('BEGIN');
      transactionStarted = true;
      await databaseConnection.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${account.externalIdentity.provider}:${account.externalIdentity.providerSubject}`],
      );

      const existingAccount = await findAccount(
        databaseConnection,
        account.externalIdentity.provider,
        account.externalIdentity.providerSubject,
      );
      if (existingAccount) {
        await databaseConnection.query('COMMIT');
        transactionStarted = false;
        return existingAccount;
      }

      await databaseConnection.query(
        `INSERT INTO identity.user_accounts (user_account_id, display_name, created_at)
         VALUES ($1, $2, $3)`,
        [account.user.id, account.user.displayName, account.user.createdAt],
      );
      await databaseConnection.query(
        `INSERT INTO identity.external_identities (
           external_identity_id,
           user_account_id,
           identity_provider,
           provider_subject,
           created_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          account.externalIdentity.id,
          account.externalIdentity.userId,
          account.externalIdentity.provider,
          account.externalIdentity.providerSubject,
          account.externalIdentity.createdAt,
        ],
      );
      await databaseConnection.query(
        `INSERT INTO identity.identity_workspaces (
           identity_workspace_id,
           owner_user_account_id,
           workspace_name,
           workspace_kind,
           created_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          account.workspace.id,
          account.workspace.ownerUserId,
          account.workspace.name,
          account.workspace.kind,
          account.workspace.createdAt,
        ],
      );

      await databaseConnection.query('COMMIT');
      transactionStarted = false;
      return account;
    } catch (persistenceError) {
      if (transactionStarted) {
        try {
          await databaseConnection.query('ROLLBACK');
        } catch {
          // Preserve the provisioning failure while still releasing the connection.
        }
      }
      throw persistenceError;
    } finally {
      databaseConnection.release();
    }
  }
}
