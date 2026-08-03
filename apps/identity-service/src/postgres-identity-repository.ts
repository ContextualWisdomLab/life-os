import type {
  IdentityProvider,
  IdentityRepository,
  ProvisionedAccount,
} from './identity-domain';
import type { SqlClient } from './postgres-security-repositories';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVALID_STORED_ACCOUNT = 'Stored identity account is invalid';

export interface SqlTransaction extends SqlClient {
  release(): void;
}

export interface TransactionalSqlClient extends SqlClient {
  connect(): Promise<SqlTransaction>;
}

interface IdentityAccountRow {
  user_id: unknown;
  display_name: unknown;
  user_created_at: unknown;
  external_identity_id: unknown;
  external_identity_user_id: unknown;
  provider: unknown;
  provider_subject: unknown;
  external_identity_created_at: unknown;
  workspace_id: unknown;
  workspace_owner_user_id: unknown;
  workspace_name: unknown;
  workspace_kind: unknown;
  workspace_created_at: unknown;
}

function requireString(value: unknown, message = INVALID_STORED_ACCOUNT): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

function requireUuidV4(value: unknown, message = INVALID_STORED_ACCOUNT): string {
  const id = requireString(value, message);
  if (!UUID_V4_PATTERN.test(id)) {
    throw new Error(message);
  }
  return id;
}

function requireProvider(value: unknown): IdentityProvider {
  if (value !== 'google' && value !== 'github') {
    throw new Error(INVALID_STORED_ACCOUNT);
  }
  return value;
}

function toIsoString(value: unknown): string {
  const date = value instanceof Date ? value : new Date(requireString(value));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(INVALID_STORED_ACCOUNT);
  }
  return date.toISOString();
}

function mapAccountRow(row: IdentityAccountRow): ProvisionedAccount {
  const userId = requireUuidV4(row.user_id);
  const externalIdentityUserId = requireUuidV4(row.external_identity_user_id);
  const workspaceOwnerUserId = requireUuidV4(row.workspace_owner_user_id);
  if (externalIdentityUserId !== userId || workspaceOwnerUserId !== userId) {
    throw new Error(INVALID_STORED_ACCOUNT);
  }
  if (row.workspace_kind !== 'personal') {
    throw new Error(INVALID_STORED_ACCOUNT);
  }

  return {
    user: {
      id: userId,
      displayName: requireString(row.display_name),
      createdAt: toIsoString(row.user_created_at),
    },
    externalIdentity: {
      id: requireUuidV4(row.external_identity_id),
      userId: externalIdentityUserId,
      provider: requireProvider(row.provider),
      providerSubject: requireString(row.provider_subject),
      createdAt: toIsoString(row.external_identity_created_at),
    },
    workspace: {
      id: requireUuidV4(row.workspace_id),
      ownerUserId: workspaceOwnerUserId,
      name: requireString(row.workspace_name),
      kind: 'personal',
      createdAt: toIsoString(row.workspace_created_at),
    },
  };
}

function validateProposedAccount(account: ProvisionedAccount): ProvisionedAccount {
  return mapAccountRow({
    user_id: account.user.id,
    display_name: account.user.displayName,
    user_created_at: account.user.createdAt,
    external_identity_id: account.externalIdentity.id,
    external_identity_user_id: account.externalIdentity.userId,
    provider: account.externalIdentity.provider,
    provider_subject: account.externalIdentity.providerSubject,
    external_identity_created_at: account.externalIdentity.createdAt,
    workspace_id: account.workspace.id,
    workspace_owner_user_id: account.workspace.ownerUserId,
    workspace_name: account.workspace.name,
    workspace_kind: account.workspace.kind,
    workspace_created_at: account.workspace.createdAt,
  });
}

async function findAccount(
  client: SqlClient,
  provider: IdentityProvider,
  providerSubject: string,
): Promise<ProvisionedAccount | undefined> {
  const result = await client.query<IdentityAccountRow>(
    `SELECT
       users.id AS user_id,
       users.display_name,
       users.created_at AS user_created_at,
       external_identities.id AS external_identity_id,
       external_identities.user_id AS external_identity_user_id,
       external_identities.provider,
       external_identities.provider_subject,
       external_identities.created_at AS external_identity_created_at,
       workspaces.id AS workspace_id,
       workspaces.owner_user_id AS workspace_owner_user_id,
       workspaces.name AS workspace_name,
       workspaces.kind AS workspace_kind,
       workspaces.created_at AS workspace_created_at
     FROM identity.external_identities
     JOIN identity.users
       ON identity.users.id = identity.external_identities.user_id
     LEFT JOIN identity.workspaces
       ON identity.workspaces.owner_user_id = identity.users.id
      AND identity.workspaces.kind = 'personal'
     WHERE identity.external_identities.provider = $1
       AND identity.external_identities.provider_subject = $2
     LIMIT 2`,
    [provider, providerSubject],
  );

  if (result.rows.length > 1) {
    throw new Error(INVALID_STORED_ACCOUNT);
  }
  const row = result.rows[0];
  return row ? mapAccountRow(row) : undefined;
}

export class PostgresIdentityRepository implements IdentityRepository {
  constructor(private readonly database: TransactionalSqlClient) {}

  async findByExternalIdentity(
    provider: IdentityProvider,
    providerSubject: string,
  ): Promise<ProvisionedAccount | undefined> {
    return await findAccount(this.database, provider, providerSubject);
  }

  async save(accountValue: ProvisionedAccount): Promise<ProvisionedAccount> {
    const account = validateProposedAccount(accountValue);
    const connection = await this.database.connect();
    let transactionStarted = false;

    try {
      await connection.query('BEGIN');
      transactionStarted = true;
      await connection.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`${account.externalIdentity.provider}:${account.externalIdentity.providerSubject}`],
      );

      const existing = await findAccount(
        connection,
        account.externalIdentity.provider,
        account.externalIdentity.providerSubject,
      );
      if (existing) {
        await connection.query('COMMIT');
        transactionStarted = false;
        return existing;
      }

      await connection.query(
        `INSERT INTO identity.users (id, display_name, created_at)
         VALUES ($1, $2, $3)`,
        [account.user.id, account.user.displayName, account.user.createdAt],
      );
      await connection.query(
        `INSERT INTO identity.external_identities (
           id,
           user_id,
           provider,
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
      await connection.query(
        `INSERT INTO identity.workspaces (
           id,
           owner_user_id,
           name,
           kind,
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

      await connection.query('COMMIT');
      transactionStarted = false;
      return account;
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.query('ROLLBACK');
        } catch {
          // Preserve the provisioning failure while still releasing the connection.
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }
}
