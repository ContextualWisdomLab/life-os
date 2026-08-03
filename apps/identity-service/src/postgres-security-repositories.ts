import type {
  OAuthTransactionRepository,
  SessionRecord,
  SessionRepository,
  StoredOAuthTransaction,
} from './auth-security';
import type { IdentityProvider } from './identity-domain';
import { AesGcmSecretBox, type EncryptedSecret } from './secret-box';

export interface SqlQueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export interface SqlClient {
  query<Row>(text: string, values?: readonly unknown[]): Promise<SqlQueryResult<Row>>;
}

interface OAuthTransactionRow {
  id: unknown;
  provider: unknown;
  state_hash: unknown;
  browser_session_hash: unknown;
  code_verifier_ciphertext: unknown;
  code_verifier_key_version: unknown;
  nonce_ciphertext: unknown;
  nonce_key_version: unknown;
  redirect_uri: unknown;
  created_at: unknown;
  expires_at: unknown;
  consumed_at: unknown;
}

interface SessionRow {
  id: unknown;
  user_id: unknown;
  workspace_id: unknown;
  token_hash: unknown;
  created_at: unknown;
  expires_at: unknown;
  revoked_at: unknown;
  rotated_from_id: unknown;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message);
  }
  return value;
}

function requireProvider(value: unknown): IdentityProvider {
  if (value !== 'google' && value !== 'github') {
    throw new Error('Stored OAuth transaction is invalid');
  }
  return value;
}

function requireBuffer(value: unknown): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new Error('Stored OAuth transaction is invalid');
  }
  return value;
}

function optionalBuffer(value: unknown): Buffer | null {
  if (value === null) {
    return null;
  }
  return requireBuffer(value);
}

function toIsoString(value: unknown, message: string): string {
  const date = value instanceof Date ? value : new Date(requireString(value, message));
  if (!Number.isFinite(date.getTime())) {
    throw new Error(message);
  }
  return date.toISOString();
}

function optionalIsoString(value: unknown, message: string): string | null {
  return value === null ? null : toIsoString(value, message);
}

function verifierContext(transactionId: string): string {
  return `oauth-transaction:${transactionId}:verifier`;
}

function nonceContext(transactionId: string): string {
  return `oauth-transaction:${transactionId}:nonce`;
}

function mapOAuthTransactionRow(
  row: OAuthTransactionRow,
  secretBox: AesGcmSecretBox,
): StoredOAuthTransaction {
  const id = requireString(row.id, 'Stored OAuth transaction is invalid');
  const provider = requireProvider(row.provider);
  const verifier: EncryptedSecret = {
    keyVersion: requireString(
      row.code_verifier_key_version,
      'Stored OAuth transaction is invalid',
    ),
    payload: requireBuffer(row.code_verifier_ciphertext),
  };
  const noncePayload = optionalBuffer(row.nonce_ciphertext);
  const nonceKeyVersion =
    row.nonce_key_version === null
      ? null
      : requireString(row.nonce_key_version, 'Stored OAuth transaction is invalid');

  if (
    (provider === 'google' && (!noncePayload || !nonceKeyVersion)) ||
    (provider === 'github' && (noncePayload !== null || nonceKeyVersion !== null))
  ) {
    throw new Error('Stored OAuth transaction is invalid');
  }

  return {
    id,
    provider,
    stateHash: requireString(row.state_hash, 'Stored OAuth transaction is invalid'),
    browserSessionHash: requireString(
      row.browser_session_hash,
      'Stored OAuth transaction is invalid',
    ),
    codeVerifier: secretBox.decrypt(verifier, verifierContext(id)),
    redirectUri: requireString(row.redirect_uri, 'Stored OAuth transaction is invalid'),
    nonce:
      noncePayload && nonceKeyVersion
        ? secretBox.decrypt(
            { keyVersion: nonceKeyVersion, payload: noncePayload },
            nonceContext(id),
          )
        : null,
    createdAt: toIsoString(row.created_at, 'Stored OAuth transaction is invalid'),
    expiresAt: toIsoString(row.expires_at, 'Stored OAuth transaction is invalid'),
    consumedAt: optionalIsoString(row.consumed_at, 'Stored OAuth transaction is invalid'),
  };
}

export class PostgresOAuthTransactionRepository implements OAuthTransactionRepository {
  constructor(
    private readonly client: SqlClient,
    private readonly secretBox: AesGcmSecretBox,
  ) {}

  async save(transaction: StoredOAuthTransaction): Promise<void> {
    const verifier = this.secretBox.encrypt(
      transaction.codeVerifier,
      verifierContext(transaction.id),
    );
    const nonce =
      transaction.nonce === null
        ? null
        : this.secretBox.encrypt(transaction.nonce, nonceContext(transaction.id));

    await this.client.query(
      `INSERT INTO identity.oauth_transactions (
        id,
        provider,
        state_hash,
        browser_session_hash,
        code_verifier_ciphertext,
        code_verifier_key_version,
        nonce_ciphertext,
        nonce_key_version,
        redirect_uri,
        created_at,
        expires_at,
        consumed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        transaction.id,
        transaction.provider,
        transaction.stateHash,
        transaction.browserSessionHash,
        verifier.payload,
        verifier.keyVersion,
        nonce?.payload ?? null,
        nonce?.keyVersion ?? null,
        transaction.redirectUri,
        transaction.createdAt,
        transaction.expiresAt,
        transaction.consumedAt,
      ],
    );
  }

  async consumeByStateHash(
    provider: IdentityProvider,
    stateHash: string,
    browserSessionHash: string,
    consumedAt: string,
  ): Promise<StoredOAuthTransaction | undefined> {
    const result = await this.client.query<OAuthTransactionRow>(
      `UPDATE identity.oauth_transactions
       SET consumed_at = $4
       WHERE provider = $1
         AND state_hash = $2
         AND browser_session_hash = $3
         AND consumed_at IS NULL
         AND expires_at > $4
       RETURNING
         id,
         provider,
         state_hash,
         browser_session_hash,
         code_verifier_ciphertext,
         code_verifier_key_version,
         nonce_ciphertext,
         nonce_key_version,
         redirect_uri,
         created_at,
         expires_at,
         consumed_at`,
      [provider, stateHash, browserSessionHash, consumedAt],
    );

    const row = result.rows[0];
    return row ? mapOAuthTransactionRow(row, this.secretBox) : undefined;
  }

  async deleteExpiredOrConsumedBefore(retentionBoundary: string): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM identity.oauth_transactions
       WHERE expires_at < $1
          OR (consumed_at IS NOT NULL AND consumed_at < $1)`,
      [retentionBoundary],
    );
    return result.rowCount ?? 0;
  }
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: requireString(row.id, 'Stored session is invalid'),
    userId: requireString(row.user_id, 'Stored session is invalid'),
    workspaceId: requireString(row.workspace_id, 'Stored session is invalid'),
    tokenHash: requireString(row.token_hash, 'Stored session is invalid'),
    createdAt: toIsoString(row.created_at, 'Stored session is invalid'),
    expiresAt: toIsoString(row.expires_at, 'Stored session is invalid'),
    revokedAt: optionalIsoString(row.revoked_at, 'Stored session is invalid'),
    rotatedFromId:
      row.rotated_from_id === null
        ? null
        : requireString(row.rotated_from_id, 'Stored session is invalid'),
  };
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly client: SqlClient) {}

  async save(session: SessionRecord): Promise<void> {
    await this.client.query(
      `INSERT INTO identity.sessions (
        id,
        user_id,
        workspace_id,
        token_hash,
        created_at,
        expires_at,
        revoked_at,
        rotated_from_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        session.id,
        session.userId,
        session.workspaceId,
        session.tokenHash,
        session.createdAt,
        session.expiresAt,
        session.revokedAt,
        session.rotatedFromId,
      ],
    );
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | undefined> {
    const result = await this.client.query<SessionRow>(
      `SELECT
         id,
         user_id,
         workspace_id,
         token_hash,
         created_at,
         expires_at,
         revoked_at,
         rotated_from_id
       FROM identity.sessions
       WHERE token_hash = $1`,
      [tokenHash],
    );
    const row = result.rows[0];
    return row ? mapSessionRow(row) : undefined;
  }

  async revokeByTokenHash(tokenHash: string, revokedAt: string): Promise<boolean> {
    const result = await this.client.query<{ id: string }>(
      `UPDATE identity.sessions
       SET revoked_at = $2
       WHERE token_hash = $1
         AND revoked_at IS NULL
       RETURNING id`,
      [tokenHash, revokedAt],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async deleteInactiveBefore(retentionBoundary: string): Promise<number> {
    const result = await this.client.query(
      `DELETE FROM identity.sessions
       WHERE expires_at < $1
          OR (revoked_at IS NOT NULL AND revoked_at < $1)`,
      [retentionBoundary],
    );
    return result.rowCount ?? 0;
  }
}
