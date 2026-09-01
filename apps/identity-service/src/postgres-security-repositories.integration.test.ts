import { createHash, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OAuthTransactionService, SessionService, type SessionRecord } from './auth-security';
import { IdentityService } from './identity-domain';
import {
  PostgresIdentityRepository,
  type SqlTransaction,
  type TransactionalSqlClient,
} from './postgres-identity-repository';
import {
  PostgresOAuthTransactionRepository,
  PostgresSessionRepository,
  type SqlClient,
  type SqlQueryResult,
} from './postgres-security-repositories';
import { AesGcmSecretBox } from './secret-box';

const DATABASE_URL = process.env.IDENTITY_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const SECRET_KEY = Buffer.from('44'.repeat(32), 'hex');

class NodePostgresTransaction implements SqlTransaction {
  constructor(private readonly client: PoolClient) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const queryResult = await this.client.query(text, [...values]);
    return {
      rows: queryResult.rows as Row[],
      rowCount: queryResult.rowCount,
    };
  }

  release(): void {
    this.client.release();
  }
}

class NodePostgresSqlClient implements SqlClient, TransactionalSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const queryResult = await this.pool.query(text, [...values]);
    return {
      rows: queryResult.rows as Row[],
      rowCount: queryResult.rowCount,
    };
  }

  async connect(): Promise<SqlTransaction> {
    return new NodePostgresTransaction(await this.pool.connect());
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function createSecretBox(): AesGcmSecretBox {
  return new AesGcmSecretBox({
    currentKeyVersion: 'v1',
    keys: { v1: SECRET_KEY },
  });
}

describeWithDatabase('PostgreSQL identity security repositories', () => {
  let pool: Pool;
  let sqlClient: NodePostgresSqlClient;

  beforeAll(async () => {
    if (!DATABASE_URL) {
      throw new Error('IDENTITY_DATABASE_URL is required for PostgreSQL integration tests');
    }

    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query('DROP SCHEMA IF EXISTS identity CASCADE');

    const migrationDirectory = resolve(process.cwd(), 'migrations');
    const migrationFiles = (await readdir(migrationDirectory))
      .filter((migrationFile) => migrationFile.endsWith('.sql'))
      .sort();
    for (const migrationFile of migrationFiles) {
      const migrationSql = await readFile(
        resolve(migrationDirectory, migrationFile),
        'utf8',
      );
      await pool.query(migrationSql);
    }

    sqlClient = new NodePostgresSqlClient(pool);
  }, 30_000);

  afterAll(async () => {
    if (pool) {
      await pool.query('DROP SCHEMA IF EXISTS identity CASCADE');
      await pool.end();
    }
  });

  it('persists one account and personal workspace when first sign-ins race', async () => {
    const providerSubject = `github-${randomUUID()}`;
    const repository = new PostgresIdentityRepository(sqlClient);
    const firstService = new IdentityService(repository);
    const secondService = new IdentityService(repository);
    const signInInput = {
      provider: 'github' as const,
      providerSubject,
      displayName: 'Integration Identity',
    };

    const [first, concurrent] = await Promise.all([
      firstService.signInWithExternalIdentity(signInInput),
      secondService.signInWithExternalIdentity(signInInput),
    ]);
    const repeated = await firstService.signInWithExternalIdentity({
      ...signInInput,
      displayName: 'Ignored Replacement Name',
    });

    expect(concurrent).toEqual(first);
    expect(repeated).toEqual(first);
    const storedIdentity = await pool.query<{
      user_account_id: string;
      external_identity_id: string;
      identity_workspace_id: string;
      display_name: string;
      workspace_owner_user_account_id: string;
    }>(
      `SELECT
         user_accounts.user_account_id,
         external_identities.external_identity_id,
         identity_workspaces.identity_workspace_id,
         user_accounts.display_name,
         identity_workspaces.owner_user_account_id AS workspace_owner_user_account_id
       FROM identity.external_identities
       JOIN identity.user_accounts
         ON user_accounts.user_account_id = external_identities.user_account_id
       JOIN identity.identity_workspaces
         ON identity_workspaces.owner_user_account_id = user_accounts.user_account_id
       WHERE identity.external_identities.identity_provider = $1
         AND identity.external_identities.provider_subject = $2`,
      ['github', providerSubject],
    );
    expect(storedIdentity.rowCount).toBe(1);
    expect(storedIdentity.rows[0]).toEqual({
      user_account_id: first.user.id,
      external_identity_id: first.externalIdentity.id,
      identity_workspace_id: first.workspace.id,
      display_name: 'Integration Identity',
      workspace_owner_user_account_id: first.user.id,
    });

    await expect(
      pool.query(
        `INSERT INTO identity.user_accounts (user_account_id, display_name)
         VALUES ($1, $2)`,
        ['00000000-0000-1000-8000-000000000000', 'Sequential Identifier'],
      ),
    ).rejects.toThrow();
  });

  it('persists encrypted OAuth transactions and consumes state exactly once', async () => {
    const now = new Date('2026-08-03T01:30:00.000Z');
    const repository = new PostgresOAuthTransactionRepository(sqlClient, createSecretBox());
    const service = new OAuthTransactionService(repository, {
      now: () => now,
      ttlMs: 10 * 60 * 1000,
    });
    const browserSessionId = `browser-${randomUUID()}`;

    const started = await service.begin('google', {
      browserSessionId,
      redirectUri: 'https://life.example.com/v1/auth/google/callback',
    });

    const storedTransaction = await pool.query<{
      state_hash: string;
      browser_session_hash: string;
      code_verifier_ciphertext: Buffer;
      code_verifier_key_version: string;
      nonce_ciphertext: Buffer;
      nonce_key_version: string;
    }>(
      `SELECT
         state_hash,
         browser_session_hash,
         code_verifier_ciphertext,
         code_verifier_key_version,
         nonce_ciphertext,
         nonce_key_version
       FROM identity.oauth_transactions
       WHERE oauth_transaction_id = $1`,
      [started.id],
    );
    const transactionRow = storedTransaction.rows[0];
    expect(transactionRow).toBeDefined();
    if (!transactionRow) {
      throw new Error('Expected persisted OAuth transaction');
    }

    expect(transactionRow.state_hash).toBe(sha256Hex(started.state));
    expect(transactionRow.browser_session_hash).toBe(sha256Hex(browserSessionId));
    expect(transactionRow.code_verifier_ciphertext).toBeInstanceOf(Buffer);
    expect(transactionRow.code_verifier_ciphertext.length).toBeGreaterThanOrEqual(28);
    expect(transactionRow.code_verifier_key_version).toBe('v1');
    expect(transactionRow.nonce_ciphertext).toBeInstanceOf(Buffer);
    expect(transactionRow.nonce_key_version).toBe('v1');

    const consumed = await service.consume('google', started.state, browserSessionId);
    expect(createHash('sha256').update(consumed.codeVerifier).digest('base64url')).toBe(
      started.codeChallenge,
    );
    expect(consumed.nonce).toBe(started.nonce);
    await expect(service.consume('google', started.state, browserSessionId)).rejects.toThrowError(
      'OAuth transaction is invalid or no longer active',
    );
  });

  it('enforces workspace ownership and preserves authentication age across persisted rotation', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const workspaceId = randomUUID();
    await pool.query(
      `INSERT INTO identity.user_accounts (user_account_id, display_name)
       VALUES ($1, $2), ($3, $4)`,
      [userId, 'Integration User', otherUserId, 'Other User'],
    );
    await pool.query(
      `INSERT INTO identity.identity_workspaces (
         identity_workspace_id, owner_user_account_id, workspace_name, workspace_kind
       ) VALUES ($1, $2, $3, 'personal')`,
      [workspaceId, userId, 'Integration workspace'],
    );

    const repository = new PostgresSessionRepository(sqlClient);
    let now = new Date('2026-08-03T01:30:00.000Z');
    const service = new SessionService(repository, {
      now: () => now,
      ttlMs: 60 * 60 * 1000,
    });
    const issued = await service.create(userId, workspaceId);

    const storedSession = await pool.query<{
      token_hash: string;
      identity_workspace_id: string;
      authenticated_at: Date;
      created_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT token_hash, identity_workspace_id, authenticated_at, created_at, revoked_at
       FROM identity.authentication_sessions
       WHERE authentication_session_id = $1`,
      [issued.session.id],
    );
    expect(storedSession.rows[0]).toMatchObject({
      token_hash: sha256Hex(issued.token),
      identity_workspace_id: workspaceId,
      authenticated_at: new Date(issued.session.authenticatedAt),
      created_at: new Date(issued.session.createdAt),
      revoked_at: null,
    });
    expect(storedSession.rows[0]?.token_hash).not.toBe(issued.token);
    await expect(service.authenticate(issued.token)).resolves.toEqual(issued.session);

    now = new Date('2026-08-03T01:45:00.000Z');
    const rotated = await service.rotate(issued.token);
    await expect(service.authenticate(issued.token)).rejects.toThrowError(
      'Session is invalid or expired',
    );
    await expect(service.authenticate(rotated.token)).resolves.toEqual(rotated.session);

    const oldSession = await pool.query<{ revoked_at: Date | null }>(
      `SELECT revoked_at
       FROM identity.authentication_sessions
       WHERE authentication_session_id = $1`,
      [issued.session.id],
    );
    const replacementSession = await pool.query<{
      rotated_from_session_id: string | null;
      authenticated_at: Date;
      created_at: Date;
    }>(
      `SELECT rotated_from_session_id, authenticated_at, created_at
       FROM identity.authentication_sessions
       WHERE authentication_session_id = $1`,
      [rotated.session.id],
    );
    expect(oldSession.rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(replacementSession.rows[0]?.rotated_from_session_id).toBe(issued.session.id);
    expect(replacementSession.rows[0]?.authenticated_at.toISOString()).toBe(
      issued.session.authenticatedAt,
    );
    expect(replacementSession.rows[0]?.created_at.toISOString()).toBe(
      rotated.session.createdAt,
    );
    expect(rotated.session.authenticatedAt).toBe(issued.session.authenticatedAt);
    expect(rotated.session.createdAt).not.toBe(issued.session.createdAt);

    const crossTenantSession: SessionRecord = {
      id: randomUUID(),
      userId: otherUserId,
      workspaceId,
      tokenHash: 'a'.repeat(64),
      authenticatedAt: '2026-08-03T01:30:00.000Z',
      createdAt: '2026-08-03T01:30:00.000Z',
      expiresAt: '2026-08-03T02:30:00.000Z',
      revokedAt: null,
      rotatedFromId: null,
    };
    await expect(repository.save(crossTenantSession)).rejects.toThrow();
  });
});
