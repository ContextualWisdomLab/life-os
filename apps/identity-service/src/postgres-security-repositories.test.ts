import { describe, expect, it } from 'vitest';
import type { SessionRecord, StoredOAuthTransaction } from './auth-security';
import {
  PostgresOAuthTransactionRepository,
  PostgresSessionRepository,
  type SqlClient,
  type SqlQueryResult,
} from './postgres-security-repositories';
import { AesGcmSecretBox } from './secret-box';

const SECRET_KEY = Buffer.from('33'.repeat(32), 'hex');

class RecordingSqlClient implements SqlClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];
  private readonly results: SqlQueryResult<unknown>[] = [];

  enqueue<Row>(result: SqlQueryResult<Row>): void {
    this.results.push(result as SqlQueryResult<unknown>);
  }

  async query<Row>(text: string, values: readonly unknown[] = []): Promise<SqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const result = this.results.shift();
    if (!result) {
      return { rows: [], rowCount: 0 };
    }
    return result as SqlQueryResult<Row>;
  }
}

function requireCall(
  client: RecordingSqlClient,
  index = 0,
): { text: string; values: readonly unknown[] } {
  const call = client.calls[index];
  expect(call).toBeDefined();
  if (!call) {
    throw new Error(`Expected SQL call at index ${index}`);
  }
  return call;
}

function createSecretBox(): AesGcmSecretBox {
  return new AesGcmSecretBox({
    currentKeyVersion: 'v1',
    keys: { v1: SECRET_KEY },
  });
}

function transactionFixture(): StoredOAuthTransaction {
  return {
    id: 'a89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac1',
    provider: 'google',
    stateHash: 'a'.repeat(64),
    browserSessionHash: 'b'.repeat(64),
    codeVerifier: 'server-only-pkce-verifier',
    redirectUri: 'https://life.example.com/v1/auth/google/callback',
    nonce: 'server-only-oidc-nonce',
    createdAt: '2026-08-03T00:00:00.000Z',
    expiresAt: '2026-08-03T00:10:00.000Z',
    consumedAt: null,
  };
}

function sessionFixture(): SessionRecord {
  return {
    id: 'b89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac2',
    userId: 'c89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac3',
    workspaceId: 'd89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac4',
    tokenHash: 'c'.repeat(64),
    authenticatedAt: '2026-08-03T00:00:00.000Z',
    createdAt: '2026-08-03T00:00:00.000Z',
    expiresAt: '2026-09-02T00:00:00.000Z',
    revokedAt: null,
    rotatedFromId: null,
  };
}

describe('PostgresOAuthTransactionRepository', () => {
  it('persists encrypted verifier and nonce values using parameterized SQL', async () => {
    const client = new RecordingSqlClient();
    const repository = new PostgresOAuthTransactionRepository(client, createSecretBox());
    const transaction = transactionFixture();

    await repository.save(transaction);

    expect(client.calls).toHaveLength(1);
    const call = requireCall(client);
    expect(call.text).toContain('INSERT INTO identity.oauth_transactions');
    expect(call.text).toContain('$1');
    expect(call.text).not.toContain(transaction.codeVerifier);
    expect(call.text).not.toContain(transaction.nonce ?? '');
    expect(call.values).toContain('v1');
    expect(call.values.some((value) => Buffer.isBuffer(value))).toBe(true);
    expect(JSON.stringify(call.values)).not.toContain(transaction.codeVerifier);
    expect(JSON.stringify(call.values)).not.toContain(transaction.nonce ?? '');
  });

  it('atomically consumes and decrypts one active transaction', async () => {
    const client = new RecordingSqlClient();
    const box = createSecretBox();
    const transaction = transactionFixture();
    const verifier = box.encrypt(
      transaction.codeVerifier,
      `oauth-transaction:${transaction.id}:verifier`,
    );
    const nonce = box.encrypt(
      transaction.nonce ?? '',
      `oauth-transaction:${transaction.id}:nonce`,
    );
    client.enqueue({
      rowCount: 1,
      rows: [
        {
          id: transaction.id,
          provider: transaction.provider,
          state_hash: transaction.stateHash,
          browser_session_hash: transaction.browserSessionHash,
          code_verifier_ciphertext: verifier.payload,
          code_verifier_key_version: verifier.keyVersion,
          nonce_ciphertext: nonce.payload,
          nonce_key_version: nonce.keyVersion,
          redirect_uri: transaction.redirectUri,
          created_at: transaction.createdAt,
          expires_at: transaction.expiresAt,
          consumed_at: '2026-08-03T00:01:00.000Z',
        },
      ],
    });
    const repository = new PostgresOAuthTransactionRepository(client, box);

    const consumed = await repository.consumeByStateHash(
      transaction.provider,
      transaction.stateHash,
      transaction.browserSessionHash,
      '2026-08-03T00:01:00.000Z',
    );

    expect(consumed).toEqual({
      ...transaction,
      consumedAt: '2026-08-03T00:01:00.000Z',
    });
    const call = requireCall(client);
    expect(call.text).toContain('UPDATE identity.oauth_transactions');
    expect(call.text).toContain('consumed_at IS NULL');
    expect(call.text).toContain('expires_at >');
    expect(call.text).toContain('RETURNING');
  });

  it('returns undefined when no active transaction can be consumed', async () => {
    const client = new RecordingSqlClient();
    client.enqueue({ rows: [], rowCount: 0 });
    const repository = new PostgresOAuthTransactionRepository(client, createSecretBox());

    await expect(
      repository.consumeByStateHash(
        'github',
        'a'.repeat(64),
        'b'.repeat(64),
        new Date().toISOString(),
      ),
    ).resolves.toBeUndefined();
  });

  it('deletes expired or previously consumed transactions with a retention boundary', async () => {
    const client = new RecordingSqlClient();
    client.enqueue({ rows: [], rowCount: 7 });
    const repository = new PostgresOAuthTransactionRepository(client, createSecretBox());

    await expect(
      repository.deleteExpiredOrConsumedBefore('2026-08-03T00:00:00.000Z'),
    ).resolves.toBe(7);
    const call = requireCall(client);
    expect(call.text).toContain('DELETE FROM identity.oauth_transactions');
    expect(call.values).toEqual(['2026-08-03T00:00:00.000Z']);
  });
});

describe('PostgresSessionRepository', () => {
  it('persists and maps workspace-scoped sessions with authentication provenance', async () => {
    const client = new RecordingSqlClient();
    const repository = new PostgresSessionRepository(client);
    const session = sessionFixture();

    await repository.save(session);
    const saveCall = requireCall(client);
    expect(saveCall.text).toContain('INSERT INTO identity.sessions');
    expect(saveCall.text).toContain('authenticated_at');
    expect(saveCall.text).not.toContain(session.tokenHash);
    expect(saveCall.values).toContain(session.workspaceId);
    expect(saveCall.values).toContain(session.authenticatedAt);

    client.enqueue({
      rowCount: 1,
      rows: [
        {
          id: session.id,
          user_id: session.userId,
          workspace_id: session.workspaceId,
          token_hash: session.tokenHash,
          authenticated_at: session.authenticatedAt,
          created_at: session.createdAt,
          expires_at: session.expiresAt,
          revoked_at: null,
          rotated_from_id: null,
        },
      ],
    });

    await expect(repository.findByTokenHash(session.tokenHash)).resolves.toEqual(session);
  });

  it('revokes a token once and does not disclose an unknown token', async () => {
    const client = new RecordingSqlClient();
    client.enqueue({ rows: [{ id: sessionFixture().id }], rowCount: 1 });
    client.enqueue({ rows: [], rowCount: 0 });
    const repository = new PostgresSessionRepository(client);

    await expect(
      repository.revokeByTokenHash('c'.repeat(64), '2026-08-03T00:02:00.000Z'),
    ).resolves.toBe(true);
    await expect(
      repository.revokeByTokenHash('d'.repeat(64), '2026-08-03T00:02:00.000Z'),
    ).resolves.toBe(false);
    expect(requireCall(client).text).toContain('revoked_at IS NULL');
  });

  it('deletes expired sessions and old revoked sessions', async () => {
    const client = new RecordingSqlClient();
    client.enqueue({ rows: [], rowCount: 3 });
    const repository = new PostgresSessionRepository(client);

    await expect(repository.deleteInactiveBefore('2026-08-03T00:00:00.000Z')).resolves.toBe(3);
    const call = requireCall(client);
    expect(call.text).toContain('DELETE FROM identity.sessions');
    expect(call.values).toEqual(['2026-08-03T00:00:00.000Z']);
  });
});
