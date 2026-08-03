import { describe, expect, it } from 'vitest';
import { InMemoryOAuthTransactionRepository, OAuthTransactionService } from './auth-security';
import { buildAuthorizationUrl } from './oauth-provider';

describe('OAuth provider authorization requests', () => {
  it('builds a Google authorization-code request with OIDC, state, nonce, and PKCE', () => {
    const transaction = new OAuthTransactionService(
      new InMemoryOAuthTransactionRepository(),
    ).begin('google');

    const authorizationUrl = new URL(
      buildAuthorizationUrl(
        'google',
        {
          clientId: 'google-client-id',
          redirectUri: 'https://life.example.com/v1/auth/google/callback',
        },
        transaction,
      ),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(authorizationUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizationUrl.searchParams.get('client_id')).toBe('google-client-id');
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(
      'https://life.example.com/v1/auth/google/callback',
    );
    expect(authorizationUrl.searchParams.get('scope')).toBe('openid email profile');
    expect(authorizationUrl.searchParams.get('state')).toBe(transaction.state);
    expect(authorizationUrl.searchParams.get('nonce')).toBe(transaction.nonce);
    expect(authorizationUrl.searchParams.get('code_challenge')).toBe(
      transaction.codeChallenge,
    );
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('builds a GitHub authorization request with minimum identity scopes and PKCE', () => {
    const transaction = new OAuthTransactionService(
      new InMemoryOAuthTransactionRepository(),
    ).begin('github');

    const authorizationUrl = new URL(
      buildAuthorizationUrl(
        'github',
        {
          clientId: 'github-client-id',
          redirectUri: 'http://localhost:4000/v1/auth/github/callback',
        },
        transaction,
      ),
    );

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      'https://github.com/login/oauth/authorize',
    );
    expect(authorizationUrl.searchParams.get('client_id')).toBe('github-client-id');
    expect(authorizationUrl.searchParams.get('scope')).toBe('read:user user:email');
    expect(authorizationUrl.searchParams.get('state')).toBe(transaction.state);
    expect(authorizationUrl.searchParams.get('code_challenge')).toBe(
      transaction.codeChallenge,
    );
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizationUrl.searchParams.has('nonce')).toBe(false);
    expect(authorizationUrl.searchParams.has('client_secret')).toBe(false);
  });

  it('rejects provider mismatches and unsafe redirect URIs', () => {
    const transaction = new OAuthTransactionService(
      new InMemoryOAuthTransactionRepository(),
    ).begin('google');

    expect(() =>
      buildAuthorizationUrl(
        'github',
        { clientId: 'client-id', redirectUri: 'https://life.example.com/callback' },
        transaction,
      ),
    ).toThrowError('OAuth transaction provider mismatch');

    expect(() =>
      buildAuthorizationUrl(
        'google',
        { clientId: 'client-id', redirectUri: 'http://life.example.com/callback' },
        transaction,
      ),
    ).toThrowError('OAuth redirect URI must use HTTPS except on loopback hosts');
  });

  it('rejects an empty client identifier', () => {
    const transaction = new OAuthTransactionService(
      new InMemoryOAuthTransactionRepository(),
    ).begin('github');

    expect(() =>
      buildAuthorizationUrl(
        'github',
        { clientId: '   ', redirectUri: 'https://life.example.com/callback' },
        transaction,
      ),
    ).toThrowError('OAuth client ID is required');
  });
});
