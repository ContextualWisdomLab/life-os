import { describe, expect, it } from 'vitest';
import { InMemoryOAuthTransactionRepository, OAuthTransactionService } from './auth-security';
import { buildTokenExchangeRequest } from './oauth-token-exchange';

const BROWSER_SESSION_ID = 'browser-session-a';

function consumeTransaction(provider: 'google' | 'github', redirectUri: string) {
  const service = new OAuthTransactionService(new InMemoryOAuthTransactionRepository());
  const started = service.begin(provider, {
    browserSessionId: BROWSER_SESSION_ID,
    redirectUri,
  });
  return service.consume(provider, started.state, BROWSER_SESSION_ID);
}

describe('OAuth authorization-code exchange requests', () => {
  it('builds a Google token request with PKCE and keeps credentials out of the URL', () => {
    const redirectUri = 'https://life.example.com/v1/auth/google/callback';
    const transaction = consumeTransaction('google', redirectUri);
    const request = buildTokenExchangeRequest(
      'google',
      {
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
        redirectUri,
      },
      'google-authorization-code',
      transaction,
    );
    const body = new URLSearchParams(request.body);

    expect(request.url).toBe('https://oauth2.googleapis.com/token');
    expect(request.method).toBe('POST');
    expect(request.headers).toEqual({
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('client_id')).toBe('google-client-id');
    expect(body.get('client_secret')).toBe('google-client-secret');
    expect(body.get('code')).toBe('google-authorization-code');
    expect(body.get('redirect_uri')).toBe(redirectUri);
    expect(body.get('code_verifier')).toBe(transaction.codeVerifier);
    expect(request.url).not.toContain('google-client-secret');
  });

  it('builds a GitHub token request with JSON response negotiation and PKCE', () => {
    const redirectUri = 'http://localhost:4000/v1/auth/github/callback';
    const transaction = consumeTransaction('github', redirectUri);
    const request = buildTokenExchangeRequest(
      'github',
      {
        clientId: 'github-client-id',
        clientSecret: 'github-client-secret',
        redirectUri,
      },
      'github-authorization-code',
      transaction,
    );
    const body = new URLSearchParams(request.body);

    expect(request.url).toBe('https://github.com/login/oauth/access_token');
    expect(request.headers.accept).toBe('application/json');
    expect(body.get('client_id')).toBe('github-client-id');
    expect(body.get('client_secret')).toBe('github-client-secret');
    expect(body.get('code')).toBe('github-authorization-code');
    expect(body.get('redirect_uri')).toBe(redirectUri);
    expect(body.get('code_verifier')).toBe(transaction.codeVerifier);
    expect(body.has('grant_type')).toBe(false);
  });

  it('rejects provider and redirect mismatches', () => {
    const redirectUri = 'https://life.example.com/callback';
    const transaction = consumeTransaction('google', redirectUri);

    expect(() =>
      buildTokenExchangeRequest(
        'github',
        {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          redirectUri,
        },
        'code',
        transaction,
      ),
    ).toThrowError('OAuth transaction provider mismatch');

    expect(() =>
      buildTokenExchangeRequest(
        'google',
        {
          clientId: 'client-id',
          clientSecret: 'client-secret',
          redirectUri: 'https://other.example.com/callback',
        },
        'code',
        transaction,
      ),
    ).toThrowError('OAuth transaction redirect URI mismatch');
  });

  it('rejects missing authorization codes or credentials', () => {
    const redirectUri = 'https://life.example.com/callback';
    const transaction = consumeTransaction('google', redirectUri);

    expect(() =>
      buildTokenExchangeRequest(
        'google',
        {
          clientId: 'client-id',
          clientSecret: '   ',
          redirectUri,
        },
        '   ',
        transaction,
      ),
    ).toThrowError('OAuth client secret is required');
  });
});
