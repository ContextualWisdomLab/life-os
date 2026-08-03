import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { IdentityProvider } from './identity-domain';
import {
  InMemoryOAuthTransactionRepository,
  InMemorySessionRepository,
  OAuthTransactionService,
  SessionService,
} from './auth-security';

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_ID = 'a89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac1';
const WORKSPACE_ID = 'b89f36b4-1f3c-4e62-a4e1-7ba3eb3b8ac2';
const BROWSER_SESSION_ID = 'browser-session-a';
const GITHUB_REDIRECT_URI = 'https://life.example.com/v1/auth/github/callback';
const GOOGLE_REDIRECT_URI = 'https://life.example.com/v1/auth/google/callback';

function sha256Base64Url(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

describe('OAuthTransactionService', () => {
  it('creates an opaque state and an S256 PKCE challenge without exposing the verifier', () => {
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository());

    const transaction = service.begin('github', {
      browserSessionId: BROWSER_SESSION_ID,
      redirectUri: GITHUB_REDIRECT_URI,
    });

    expect(transaction.id).toMatch(UUID_V4_PATTERN);
    expect(transaction.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(transaction.codeChallenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(transaction.codeChallengeMethod).toBe('S256');
    expect(transaction.redirectUri).toBe(GITHUB_REDIRECT_URI);
    expect(transaction).not.toHaveProperty('codeVerifier');

    const consumed = service.consume('github', transaction.state, BROWSER_SESSION_ID);
    expect(consumed.codeVerifier).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(sha256Base64Url(consumed.codeVerifier)).toBe(transaction.codeChallenge);
    expect(consumed.redirectUri).toBe(GITHUB_REDIRECT_URI);
  });

  it('consumes an OAuth state exactly once', () => {
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository());
    const transaction = service.begin('google', {
      browserSessionId: BROWSER_SESSION_ID,
      redirectUri: GOOGLE_REDIRECT_URI,
    });

    service.consume('google', transaction.state, BROWSER_SESSION_ID);

    expect(() =>
      service.consume('google', transaction.state, BROWSER_SESSION_ID),
    ).toThrowError('OAuth transaction is invalid or no longer active');
  });

  it('rejects expired, provider-mismatched, or browser-mismatched OAuth states', () => {
    let now = new Date('2026-08-03T00:00:00.000Z');
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository(), {
      now: () => now,
      ttlMs: 60_000,
    });
    const githubTransaction = service.begin('github', {
      browserSessionId: BROWSER_SESSION_ID,
      redirectUri: GITHUB_REDIRECT_URI,
    });

    expect(() =>
      service.consume('google', githubTransaction.state, BROWSER_SESSION_ID),
    ).toThrowError('OAuth transaction is invalid or no longer active');

    expect(() =>
      service.consume('github', githubTransaction.state, 'browser-session-b'),
    ).toThrowError('OAuth transaction is invalid or no longer active');

    now = new Date('2026-08-03T00:02:00.000Z');
    expect(() =>
      service.consume('github', githubTransaction.state, BROWSER_SESSION_ID),
    ).toThrowError('OAuth transaction is invalid or no longer active');
  });

  it('rejects unsupported providers and unsafe redirect URIs at runtime', () => {
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository());

    expect(() =>
      service.begin('gitlab' as IdentityProvider, {
        browserSessionId: BROWSER_SESSION_ID,
        redirectUri: 'https://life.example.com/v1/auth/gitlab/callback',
      }),
    ).toThrowError('Unsupported identity provider');

    expect(() =>
      service.begin('github', {
        browserSessionId: BROWSER_SESSION_ID,
        redirectUri: 'http://life.example.com/v1/auth/github/callback',
      }),
    ).toThrowError('OAuth redirect URI must use HTTPS except on loopback hosts');
  });

  it('rejects invalid transaction TTL values', () => {
    expect(
      () =>
        new OAuthTransactionService(new InMemoryOAuthTransactionRepository(), {
          ttlMs: 0,
        }),
    ).toThrowError('OAuth transaction TTL must be a positive integer');
  });
});

describe('SessionService', () => {
  it('issues an opaque token while persisting only its hash', () => {
    const repository = new InMemorySessionRepository();
    const service = new SessionService(repository);

    const issued = service.create(USER_ID, WORKSPACE_ID);

    expect(issued.session.id).toMatch(UUID_V4_PATTERN);
    expect(issued.session.workspaceId).toBe(WORKSPACE_ID);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.token).not.toMatch(/^\d+$/);
    expect(repository.findByTokenHash(sha256Hex(issued.token))?.tokenHash).toBe(
      sha256Hex(issued.token),
    );
    expect(repository.findByTokenHash(issued.token)).toBeUndefined();
  });

  it('authenticates active sessions and rejects replay after revocation', () => {
    const service = new SessionService(new InMemorySessionRepository());
    const issued = service.create(USER_ID, WORKSPACE_ID);

    expect(service.authenticate(issued.token)).toMatchObject({
      id: issued.session.id,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });

    service.revoke(issued.token);
    expect(() => service.authenticate(issued.token)).toThrowError('Session is invalid or expired');
    expect(service.revoke(issued.token)).toBeUndefined();
    expect(service.revoke('unknown-opaque-session-token')).toBeUndefined();
  });

  it('rotates a session and invalidates the previous token', () => {
    const service = new SessionService(new InMemorySessionRepository());
    const issued = service.create(USER_ID, WORKSPACE_ID);

    const rotated = service.rotate(issued.token);

    expect(rotated.token).not.toBe(issued.token);
    expect(rotated.session.rotatedFromId).toBe(issued.session.id);
    expect(rotated.session.userId).toBe(USER_ID);
    expect(rotated.session.workspaceId).toBe(WORKSPACE_ID);
    expect(() => service.authenticate(issued.token)).toThrowError('Session is invalid or expired');
    expect(service.authenticate(rotated.token)).toEqual(rotated.session);
  });

  it('rejects expired sessions and invalid internal IDs', () => {
    let now = new Date('2026-08-03T00:00:00.000Z');
    const service = new SessionService(new InMemorySessionRepository(), {
      now: () => now,
      ttlMs: 60_000,
    });

    expect(() => service.create('123456', WORKSPACE_ID)).toThrowError(
      'User ID must be an opaque UUIDv4',
    );
    expect(() => service.create(USER_ID, '123456')).toThrowError(
      'Workspace ID must be an opaque UUIDv4',
    );

    const issued = service.create(USER_ID, WORKSPACE_ID);
    now = new Date('2026-08-03T00:02:00.000Z');

    expect(() => service.authenticate(issued.token)).toThrowError('Session is invalid or expired');
  });

  it('rejects invalid session TTL values', () => {
    expect(
      () =>
        new SessionService(new InMemorySessionRepository(), {
          ttlMs: -1,
        }),
    ).toThrowError('Session TTL must be a positive integer');
  });
});
