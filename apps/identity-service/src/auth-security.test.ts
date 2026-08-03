import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InMemoryOAuthTransactionRepository,
  InMemorySessionRepository,
  OAuthTransactionService,
  SessionService,
} from './auth-security';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('OAuthTransactionService', () => {
  it('creates an opaque state and an S256 PKCE challenge without exposing the verifier', () => {
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository());

    const transaction = service.begin('github');

    expect(transaction.id).toMatch(UUID_V4_PATTERN);
    expect(transaction.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(transaction.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(transaction.codeChallengeMethod).toBe('S256');
    expect(transaction).not.toHaveProperty('codeVerifier');

    const consumed = service.consume('github', transaction.state);
    expect(sha256Base64Url(consumed.codeVerifier)).toBe(transaction.codeChallenge);
  });

  it('consumes an OAuth state exactly once', () => {
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository());
    const transaction = service.begin('google');

    service.consume('google', transaction.state);

    expect(() => service.consume('google', transaction.state)).toThrowError(
      'OAuth transaction is invalid or no longer active',
    );
  });

  it('rejects expired or provider-mismatched OAuth states', () => {
    let now = new Date('2026-08-03T00:00:00.000Z');
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository(), {
      now: () => now,
      ttlMs: 60_000,
    });
    const githubTransaction = service.begin('github');

    expect(() => service.consume('google', githubTransaction.state)).toThrowError(
      'OAuth transaction is invalid or no longer active',
    );

    now = new Date('2026-08-03T00:02:00.000Z');
    expect(() => service.consume('github', githubTransaction.state)).toThrowError(
      'OAuth transaction is invalid or no longer active',
    );
  });
});

describe('SessionService', () => {
  it('issues an opaque token while persisting only its hash', () => {
    const repository = new InMemorySessionRepository();
    const service = new SessionService(repository);
    const userId = 'a89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac1';

    const issued = service.create(userId);

    expect(issued.session.id).toMatch(UUID_V4_PATTERN);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.token).not.toMatch(/^\d+$/);
    expect(repository.findByTokenHash(sha256Hex(issued.token))?.tokenHash).toBe(
      sha256Hex(issued.token),
    );
    expect(repository.findByTokenHash(issued.token)).toBeUndefined();
  });

  it('authenticates active sessions and rejects replay after revocation', () => {
    const service = new SessionService(new InMemorySessionRepository());
    const issued = service.create('a89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac1');

    expect(service.authenticate(issued.token)).toMatchObject({
      id: issued.session.id,
      userId: issued.session.userId,
    });

    service.revoke(issued.token);
    expect(() => service.authenticate(issued.token)).toThrowError('Session is invalid or expired');
  });

  it('rejects expired sessions and non-UUID internal user IDs', () => {
    let now = new Date('2026-08-03T00:00:00.000Z');
    const service = new SessionService(new InMemorySessionRepository(), {
      now: () => now,
      ttlMs: 60_000,
    });

    expect(() => service.create('123456')).toThrowError('User ID must be an opaque UUIDv4');

    const issued = service.create('a89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac1');
    now = new Date('2026-08-03T00:02:00.000Z');

    expect(() => service.authenticate(issued.token)).toThrowError('Session is invalid or expired');
  });
});
