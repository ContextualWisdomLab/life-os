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
    const result = await this.client.query(text, [...values]);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount,
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
    const result = await this.pool.query(text, [...values]);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount,
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
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const migrationFile of migrationFiles) {
      const migration = await readFile(resolve(migrationDirectory, migrationFile), 'utf8');
      await pool.query(migration);
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
    const input = {
      provider: 'github' as const,
      providerSubject,
      displayName: 'Integration Identity',
    };

    const [first, concurrent] = await Promise.all([
      firstService.signInWithExternalIdentity(input),
      secondService.signInWithExternalIdentity(input),
    ]);
    const repeated = await firstService.signInWithExternalIdentity({
      ...input,
      displayName: 'Ignored Replacement Name',
    });

    expect(concurrent).toEqual(first);
    expect(repeated).toEqual(first);
    const stored = await pool.query<{
      user_id: string;
      external_identity_id: string;
      workspace_id: string;
      display_name: string;
      workspace_owner_user_id: string;
    }>(
      `SELECT
         users.id AS user_id,
         external_identities.id AS external_identity_id,
         workspaces.id AS workspace_id,
         users.display_name,
         workspaces.owner_user_id AS workspace_owner_user_id
       FROM identity.external_identities
       JOIN identity.users ON identity.users.id = identity.external_identities.user_id
       JOIN identity.workspaces ON identity.workspaces.owner_user_id = identity.users.id
       WHERE identity.external_identities.provider = $1
         AND identity.external_identities.provider_subject = $2`,
      ['github', providerSubject],
    );
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0]).toEqual({
      user_id: first.user.id,
      external_identity_id: first.externalIdentity.id,
      workspace_id: first.workspace.id,
      display_name: 'Integration Identity',
      workspace_owner_user_id: first.user.id,
    });

    await expect(
      pool.query(
        `INSERT INTO identity.users (id, display_name)
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

    const stored = await pool.query<{
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
       WHERE id = $1`,
      [started.id],
    );
    const row = stored.rows[0];
    expect(row).toBeDefined();
    if (!row) {
      throw new Error('Expected persisted OAuth transaction');
    }

    expect(row.state_hash).toBe(sha256Hex(started.state));
    expect(row.browser_session_hash).toBe(sha256Hex(browserSessionId));
    expect(row.code_verifier_ciphertext).toBeInstanceOf(Buffer);
    expect(row.code_verifier_ciphertext.length).toBeGreaterThanOrEqual(28);
    expect(row.code_verifier_key_version).toBe('v1');
    expect(row.nonce_ciphertext).toBeInstanceOf(Buffer);
    expect(row.nonce_key_version).toBe('v1');

    const consumed = await service.consume('google', started.state, browserSessionId);
    expect(createHash('sha256').update(consumed.codeVerifier).digest('base64url')).toBe(
      started.codeChallenge,
    );
    expect(consumed.nonce).toBe(started.nonce);
    await expect(service.consume('google', started.state, browserSessionId)).rejects.toThrowError(
      'OAuth transaction is invalid or no longer active',
    );
  });

  it('enforces workspace ownership and rotates persisted sessions atomically at revocation', async () => {
    const userId = randomUUID();
    const otherUserId = randomUUID();
    const workspaceId = randomUUID();
    await pool.query(
      `INSERT INTO identity.users (id, display_name)
       VALUES ($1, $2), ($3, $4)`,
      [userId, 'Integration User', otherUserId, 'Other User'],
    );
    await pool.query(
      `INSERT INTO identity.workspaces (id, owner_user_id, name, kind)
       VALUES ($1, $2, $3, 'personal')`,
      [workspaceId, userId, 'Integration workspace'],
    );

    const repository = new PostgresSessionRepository(sqlClient);
    const service = new SessionService(repository, {
      now: () => new Date('2026-08-03T01:30:00.000Z'),
      ttlMs: 60 * 60 * 1000,
    });
    const issued = await service.create(userId, workspaceId);

    const stored = await pool.query<{
      token_hash: string;
      workspace_id: string;
      revoked_at: Date | null;
    }>(
      `SELECT token_hash, workspace_id, revoked_at
       FROM identity.sessions
       WHERE id = $1`,
      [issued.session.id],
    );
    expect(stored.rows[0]).toMatchObject({
      token_hash: sha256Hex(issued.token),
      workspace_id: workspaceId,
      revoked_at: null,
    });
    expect(stored.rows[0]?.token_hash).not.toBe(issued.token);
    await expect(service.authenticate(issued.token)).resolves.toEqual(issued.session);

    const rotated = await service.rotate(issued.token);
    await expect(service.authenticate(issued.token)).rejects.toThrowError(
      'Session is invalid or expired',
    );
    await expect(service.authenticate(rotated.token)).resolves.toEqual(rotated.session);

    const oldSession = await pool.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM identity.sessions WHERE id = $1',
      [issued.session.id],
    );
    const replacement = await pool.query<{ rotated_from_id: string | null }>(
      'SELECT rotated_from_id FROM identity.sessions WHERE id = $1',
      [rotated.session.id],
    );
    expect(oldSession.rows[0]?.revoked_at).toBeInstanceOf(Date);
    expect(replacement.rows[0]?.rotated_from_id).toBe(issued.session.id);

    const crossTenantSession: SessionRecord = {
      id: randomUUID(),
      userId: otherUserId,
      workspaceId,
      tokenHash: 'a'.repeat(64),
      createdAt: '2026-08-03T01:30:00.000Z',
      expiresAt: '2026-08-03T02:30:00.000Z',
      revokedAt: null,
      rotatedFromId: null,
    };
    await expect(repository.save(crossTenantSession)).rejects.toThrow();
  });
});
