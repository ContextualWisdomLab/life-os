import { describe, expect, it } from 'vitest';
import {
  buildGitHubIdentityRequests,
  normalizeGitHubIdentity,
  parseOAuthTokenResponse,
  validateVerifiedGoogleIdentity,
} from './oauth-provider-response';

const NOW = new Date('2026-08-03T01:00:00.000Z');

function verifiedGoogleToken(overrides: Record<string, unknown> = {}) {
  return {
    signatureVerified: true as const,
    claims: {
      iss: 'https://accounts.google.com',
      sub: '123456789012345678901',
      aud: 'google-client-id',
      exp: Math.floor(NOW.getTime() / 1000) + 600,
      iat: Math.floor(NOW.getTime() / 1000) - 10,
      nonce: 'expected-nonce',
      email: 'user@example.com',
      email_verified: true,
      name: 'Example User',
      ...overrides,
    },
  };
}

describe('OAuth provider token responses', () => {
  it('parses Google bearer tokens and requires an ID token', () => {
    const parsed = parseOAuthTokenResponse('google', {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({
        access_token: 'google-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'openid email profile',
        id_token: 'signed-google-id-token',
      }),
    });

    expect(parsed).toEqual({
      provider: 'google',
      accessToken: 'google-access-token',
      tokenType: 'bearer',
      expiresInSeconds: 3600,
      scopes: ['openid', 'email', 'profile'],
      idToken: 'signed-google-id-token',
    });
  });

  it('parses comma-delimited GitHub scopes', () => {
    const parsed = parseOAuthTokenResponse('github', {
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: 'github-access-token',
        token_type: 'bearer',
        scope: 'read:user,user:email',
      }),
    });

    expect(parsed.scopes).toEqual(['read:user', 'user:email']);
    expect(parsed).not.toHaveProperty('idToken');
  });

  it('rejects provider errors, non-JSON bodies, and unsupported token types generically', () => {
    expect(() =>
      parseOAuthTokenResponse('github', {
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'bad_verification_code', secret: 'do-not-echo' }),
      }),
    ).toThrowError('OAuth provider response is invalid');

    expect(() =>
      parseOAuthTokenResponse('github', {
        status: 200,
        contentType: 'text/html',
        body: '<html>proxy error</html>',
      }),
    ).toThrowError('OAuth provider response is invalid');

    expect(() =>
      parseOAuthTokenResponse('github', {
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ access_token: 'token', token_type: 'mac' }),
      }),
    ).toThrowError('OAuth provider response is invalid');
  });
});

describe('Google identity claims after signature verification', () => {
  it('validates issuer, audience, expiry, nonce, and verified email', () => {
    const identity = validateVerifiedGoogleIdentity(verifiedGoogleToken(), {
      clientId: 'google-client-id',
      nonce: 'expected-nonce',
      now: NOW,
    });

    expect(identity).toEqual({
      provider: 'google',
      providerSubject: '123456789012345678901',
      displayName: 'Example User',
      verifiedEmail: 'user@example.com',
    });
  });

  it('rejects unsigned, expired, nonce-mismatched, and ambiguous-audience claims', () => {
    expect(() =>
      validateVerifiedGoogleIdentity(
        { signatureVerified: false as never, claims: verifiedGoogleToken().claims },
        { clientId: 'google-client-id', nonce: 'expected-nonce', now: NOW },
      ),
    ).toThrowError('Google ID token is invalid');

    expect(() =>
      validateVerifiedGoogleIdentity(
        verifiedGoogleToken({ exp: Math.floor(NOW.getTime() / 1000) - 301 }),
        { clientId: 'google-client-id', nonce: 'expected-nonce', now: NOW },
      ),
    ).toThrowError('Google ID token is invalid');

    expect(() =>
      validateVerifiedGoogleIdentity(verifiedGoogleToken(), {
        clientId: 'google-client-id',
        nonce: 'different-nonce',
        now: NOW,
      }),
    ).toThrowError('Google ID token is invalid');

    expect(() =>
      validateVerifiedGoogleIdentity(
        verifiedGoogleToken({ aud: ['google-client-id', 'other-client'] }),
        { clientId: 'google-client-id', nonce: 'expected-nonce', now: NOW },
      ),
    ).toThrowError('Google ID token is invalid');
  });
});

describe('GitHub identity retrieval and normalization', () => {
  it('builds fixed-endpoint authenticated requests without tokens in URLs', () => {
    const requests = buildGitHubIdentityRequests('github-access-token');

    expect(requests.user.url).toBe('https://api.github.com/user');
    expect(requests.emails.url).toBe('https://api.github.com/user/emails');
    expect(requests.user.headers.authorization).toBe('Bearer github-access-token');
    expect(requests.user.url).not.toContain('github-access-token');
    expect(requests.emails.url).not.toContain('github-access-token');
  });

  it('keeps the numeric GitHub subject external and prefers a verified primary email', () => {
    const identity = normalizeGitHubIdentity(
      { id: 8172694, login: 'example-user', name: 'Example User' },
      [
        { email: 'secondary@example.com', verified: true, primary: false },
        { email: 'primary@example.com', verified: true, primary: true },
      ],
    );

    expect(identity).toEqual({
      provider: 'github',
      providerSubject: '8172694',
      displayName: 'Example User',
      verifiedEmail: 'primary@example.com',
    });
  });

  it('rejects unsafe numeric IDs and ignores unverified email addresses', () => {
    expect(() =>
      normalizeGitHubIdentity({ id: Number.MAX_SAFE_INTEGER + 1, login: 'unsafe' }, []),
    ).toThrowError('GitHub identity response is invalid');

    expect(
      normalizeGitHubIdentity(
        { id: '8172694', login: 'example-user' },
        [{ email: 'unverified@example.com', verified: false, primary: true }],
      ),
    ).toEqual({
      provider: 'github',
      providerSubject: '8172694',
      displayName: 'example-user',
    });
  });
});
