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
    const queryResult = this.results.shift();
    if (!queryResult) {
      return { rows: [], rowCount: 0 };
    }
    return queryResult as SqlQueryResult<Row>;
  }
}

function requireCall(
  client: RecordingSqlClient,
  index = 0,
): { text: string; values: readonly unknown[] } {
  const queryCall = client.calls[index];
  expect(queryCall).toBeDefined();
  if (!queryCall) {
    throw new Error(`Expected SQL call at index ${index}`);
  }
  return queryCall;
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
    const queryCall = requireCall(client);
    expect(queryCall.text).toContain('INSERT INTO identity.oauth_transactions');
    expect(queryCall.text).toContain('oauth_transaction_id');
    expect(queryCall.text).toContain('identity_provider');
    expect(queryCall.text).toContain('$1');
    expect(queryCall.text).not.toContain(transaction.codeVerifier);
    expect(queryCall.text).not.toContain(transaction.nonce ?? '');
    expect(queryCall.values).toContain('v1');
    expect(queryCall.values.some((value) => Buffer.isBuffer(value))).toBe(true);
    expect(JSON.stringify(queryCall.values)).not.toContain(transaction.codeVerifier);
    expect(JSON.stringify(queryCall.values)).not.toContain(transaction.nonce ?? '');
  });

  it('atomically consumes and decrypts one active transaction', async () => {
    const client = new RecordingSqlClient();
    const secretBox = createSecretBox();
    const transaction = transactionFixture();
    const verifier = secretBox.encrypt(
      transaction.codeVerifier,
      `oauth-transaction:${transaction.id}:verifier`,
    );
    const nonce = secretBox.encrypt(
      transaction.nonce ?? '',
      `oauth-transaction:${transaction.id}:nonce`,
    );
    client.enqueue({
      rowCount: 1,
      rows: [
        {
          oauth_transaction_id: transaction.id,
          identity_provider: transaction.provider,
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
    const repository = new PostgresOAuthTransactionRepository(client, secretBox);

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
    const queryCall = requireCall(client);
    expect(queryCall.text).toContain('UPDATE identity.oauth_transactions');
    expect(queryCall.text).toContain('identity_provider = $1');
    expect(queryCall.text).toContain('consumed_at IS NULL');
    expect(queryCall.text).toContain('expires_at >');
    expect(queryCall.text).toContain('RETURNING');
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
    const queryCall = requireCall(client);
    expect(queryCall.text).toContain('DELETE FROM identity.oauth_transactions');
    expect(queryCall.values).toEqual(['2026-08-03T00:00:00.000Z']);
  });
});

describe('PostgresSessionRepository', () => {
  it('persists and maps workspace-scoped sessions with authentication provenance', async () => {
    const client = new RecordingSqlClient();
    const repository = new PostgresSessionRepository(client);
    const session = sessionFixture();

    await repository.save(session);
    const saveCall = requireCall(client);
    expect(saveCall.text).toContain('INSERT INTO identity.authentication_sessions');
    expect(saveCall.text).toContain('authentication_session_id');
    expect(saveCall.text).toContain('user_account_id');
    expect(saveCall.text).toContain('identity_workspace_id');
    expect(saveCall.text).toContain('authenticated_at');
    expect(saveCall.text).not.toContain(session.tokenHash);
    expect(saveCall.values).toContain(session.workspaceId);
    expect(saveCall.values).toContain(session.authenticatedAt);

    client.enqueue({
      rowCount: 1,
      rows: [
        {
          authentication_session_id: session.id,
          user_account_id: session.userId,
          identity_workspace_id: session.workspaceId,
          token_hash: session.tokenHash,
          authenticated_at: session.authenticatedAt,
          created_at: session.createdAt,
          expires_at: session.expiresAt,
          revoked_at: null,
          rotated_from_session_id: null,
        },
      ],
    });

    await expect(repository.findByTokenHash(session.tokenHash)).resolves.toEqual(session);
  });

  it('revokes a token once and does not disclose an unknown token', async () => {
    const client = new RecordingSqlClient();
    client.enqueue({
      rows: [{ authentication_session_id: sessionFixture().id }],
      rowCount: 1,
    });
    client.enqueue({ rows: [], rowCount: 0 });
    const repository = new PostgresSessionRepository(client);

    await expect(
      repository.revokeByTokenHash('c'.repeat(64), '2026-08-03T00:02:00.000Z'),
    ).resolves.toBe(true);
    await expect(
      repository.revokeByTokenHash('d'.repeat(64), '2026-08-03T00:02:00.000Z'),
    ).resolves.toBe(false);
    expect(requireCall(client).text).toContain('revoked_at IS NULL');
    expect(requireCall(client).text).toContain('RETURNING authentication_session_id');
  });

  it('deletes expired sessions and old revoked sessions', async () => {
    const client = new RecordingSqlClient();
    client.enqueue({ rows: [], rowCount: 3 });
    const repository = new PostgresSessionRepository(client);

    await expect(repository.deleteInactiveBefore('2026-08-03T00:00:00.000Z')).resolves.toBe(3);
    const queryCall = requireCall(client);
    expect(queryCall.text).toContain('DELETE FROM identity.authentication_sessions');
    expect(queryCall.values).toEqual(['2026-08-03T00:00:00.000Z']);
  });
});
