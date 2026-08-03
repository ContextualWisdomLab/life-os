import { describe, expect, it } from 'vitest';
import {
  InMemoryOAuthTransactionRepository,
  InMemorySessionRepository,
  OAuthTransactionService,
  SessionService,
  sha256Base64Url,
} from './oauth-security';

const NOW = new Date('2026-08-03T00:00:00.000Z');
const LATER = new Date('2026-08-03T00:11:00.000Z');
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('OAuthTransactionService', () => {
  it('creates an opaque one-time state and an RFC 7636 S256 PKCE challenge', () => {
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository(), {
      now: () => NOW,
      ttlMs: 10 * 60 * 1000,
    });

    const authorization = service.beginAuthorization({
      provider: 'github',
      browserSessionId: 'browser-session-a',
      redirectUri: 'https://life.example/auth/github/callback',
    });

    expect(authorization.state).toMatch(BASE64URL_PATTERN);
    expect(authorization.state.length).toBeGreaterThanOrEqual(43);
    expect(authorization.state).not.toMatch(/^\d+$/);
    expect(authorization.codeChallengeMethod).toBe('S256');

    const callback = service.consumeCallback({
      provider: 'github',
      browserSessionId: 'browser-session-a',
      state: authorization.state,
    });

    expect(callback.codeVerifier).toMatch(BASE64URL_PATTERN);
    expect(callback.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(callback.codeVerifier.length).toBeLessThanOrEqual(128);
    expect(authorization.codeChallenge).toBe(sha256Base64Url(callback.codeVerifier));
  });

  it('rejects replay of an already consumed authorization transaction', () => {
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository(), {
      now: () => NOW,
    });
    const authorization = service.beginAuthorization({
      provider: 'google',
      browserSessionId: 'browser-session-a',
      redirectUri: 'https://life.example/auth/google/callback',
    });

    service.consumeCallback({
      provider: 'google',
      browserSessionId: 'browser-session-a',
      state: authorization.state,
    });

    expect(() =>
      service.consumeCallback({
        provider: 'google',
        browserSessionId: 'browser-session-a',
        state: authorization.state,
      }),
    ).toThrowError('OAuth transaction is invalid or already consumed');
  });

  it('binds the transaction to both provider and browser session', () => {
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository(), {
      now: () => NOW,
    });
    const authorization = service.beginAuthorization({
      provider: 'github',
      browserSessionId: 'browser-session-a',
      redirectUri: 'https://life.example/auth/github/callback',
    });

    expect(() =>
      service.consumeCallback({
        provider: 'google',
        browserSessionId: 'browser-session-a',
        state: authorization.state,
      }),
    ).toThrowError('OAuth transaction binding mismatch');

    expect(() =>
      service.consumeCallback({
        provider: 'github',
        browserSessionId: 'browser-session-b',
        state: authorization.state,
      }),
    ).toThrowError('OAuth transaction binding mismatch');
  });

  it('rejects expired authorization transactions', () => {
    let currentTime = NOW;
    const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository(), {
      now: () => currentTime,
      ttlMs: 10 * 60 * 1000,
    });
    const authorization = service.beginAuthorization({
      provider: 'google',
      browserSessionId: 'browser-session-a',
      redirectUri: 'https://life.example/auth/google/callback',
    });

    currentTime = LATER;

    expect(() =>
      service.consumeCallback({
        provider: 'google',
        browserSessionId: 'browser-session-a',
        state: authorization.state,
      }),
    ).toThrowError('OAuth transaction expired');
  });
});

describe('SessionService', () => {
  it('issues a random opaque token while retaining only its digest', () => {
    const repository = new InMemorySessionRepository();
    const service = new SessionService(repository, { now: () => NOW });

    const issued = service.issue({
      userId: 'user-opaque-a',
      workspaceId: 'workspace-opaque-a',
    });

    expect(issued.token).toMatch(BASE64URL_PATTERN);
    expect(issued.token.length).toBeGreaterThanOrEqual(43);
    expect(issued.token).not.toMatch(/^\d+$/);
    expect(issued.session.id).toMatch(UUID_V4_PATTERN);
    expect(issued.session.tokenHash).toBe(sha256Base64Url(issued.token));
    expect(repository.containsRawToken(issued.token)).toBe(false);
    expect(service.authenticate(issued.token)).toEqual(issued.session);
  });

  it('rotates sessions and invalidates the previous token', () => {
    const service = new SessionService(new InMemorySessionRepository(), { now: () => NOW });
    const first = service.issue({
      userId: 'user-opaque-a',
      workspaceId: 'workspace-opaque-a',
    });

    const rotated = service.rotate(first.token);

    expect(rotated.token).not.toBe(first.token);
    expect(rotated.session.rotatedFromId).toBe(first.session.id);
    expect(service.authenticate(first.token)).toBeUndefined();
    expect(service.authenticate(rotated.token)).toEqual(rotated.session);
  });

  it('revokes a session without exposing whether an unknown token existed', () => {
    const service = new SessionService(new InMemorySessionRepository(), { now: () => NOW });
    const issued = service.issue({
      userId: 'user-opaque-a',
      workspaceId: 'workspace-opaque-a',
    });

    expect(service.revoke(issued.token)).toBeUndefined();
    expect(service.authenticate(issued.token)).toBeUndefined();
    expect(service.revoke('unknown-but-opaque-token')).toBeUndefined();
  });

  it('rejects numeric-only internal identifiers', () => {
    const service = new SessionService(new InMemorySessionRepository(), { now: () => NOW });

    expect(() =>
      service.issue({
        userId: '12345',
        workspaceId: 'workspace-opaque-a',
      }),
    ).toThrowError('Identifier must be an opaque non-numeric string');
  });
});
