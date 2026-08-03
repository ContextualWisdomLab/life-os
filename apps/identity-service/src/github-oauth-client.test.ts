import { describe, expect, it, vi } from 'vitest';
import type { ConsumedOAuthTransaction } from './auth-security';
import {
  GitHubOAuthClient,
  type OAuthProviderRequestExecutor,
} from './github-oauth-client';
import type {
  OAuthProviderHttpRequest,
  OAuthProviderHttpResult,
} from './oauth-provider-http-client';

const CLIENT_ID = 'life-os-github-client';
const CLIENT_CREDENTIAL = ['confidential', 'github', 'credential'].join('-');
const MOCK_ACCESS_VALUE = ['mock', 'provider', 'access'].join('-');
const REDIRECT_URI = 'https://identity.example.test/v1/auth/github/callback';
const AUTHORIZATION_CODE = 'github-authorization-code';
const CODE_VERIFIER = 'v'.repeat(64);

function transaction(
  overrides: Partial<ConsumedOAuthTransaction> = {},
): ConsumedOAuthTransaction {
  return {
    id: 'f583952b-974d-4c8b-8f35-8ad0c8994c98',
    provider: 'github',
    codeVerifier: CODE_VERIFIER,
    redirectUri: REDIRECT_URI,
    ...overrides,
  };
}

function jsonResult(
  body: unknown,
  status = 200,
  contentType = 'application/json; charset=utf-8',
): OAuthProviderHttpResult {
  return {
    status,
    contentType,
    body: JSON.stringify(body),
  };
}

function createClient(execute: OAuthProviderRequestExecutor['execute']) {
  return new GitHubOAuthClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_CREDENTIAL,
    redirectUri: REDIRECT_URI,
    httpClient: { execute },
  });
}

describe('GitHubOAuthClient', () => {
  it('returns a normalized identity from fixed GitHub endpoints', async () => {
    const requests: OAuthProviderHttpRequest[] = [];
    const execute = vi.fn(async (request: OAuthProviderHttpRequest) => {
      requests.push(request);
      if (request.url === 'https://github.com/login/oauth/access_token') {
        return jsonResult({
          access_token: MOCK_ACCESS_VALUE,
          token_type: 'bearer',
          scope: 'read:user,user:email',
        });
      }
      if (request.url === 'https://api.github.com/user') {
        return jsonResult({
          id: 58_323_117,
          login: 'example-person',
          name: 'Example Person',
        });
      }
      if (request.url === 'https://api.github.com/user/emails') {
        return jsonResult([
          {
            email: 'secondary@example.test',
            primary: false,
            verified: true,
          },
          {
            email: 'primary@example.test',
            primary: true,
            verified: true,
          },
        ]);
      }
      throw new Error('unexpected endpoint');
    });

    const identity = await createClient(execute).authenticateAuthorizationCode(
      AUTHORIZATION_CODE,
      transaction(),
    );

    expect(identity).toEqual({
      provider: 'github',
      providerSubject: '58323117',
      displayName: 'Example Person',
      verifiedEmail: 'primary@example.test',
    });
    expect(Object.isFrozen(identity)).toBe(true);
    expect(JSON.stringify(identity)).not.toContain(MOCK_ACCESS_VALUE);
    expect(requests.map((request) => request.url)).toEqual([
      'https://github.com/login/oauth/access_token',
      'https://api.github.com/user',
      'https://api.github.com/user/emails',
    ]);

    const tokenRequest = requests[0];
    expect(tokenRequest).toMatchObject({
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
    });
    const form = new URLSearchParams(tokenRequest?.body);
    expect(Object.fromEntries(form)).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_CREDENTIAL,
      code: AUTHORIZATION_CODE,
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
    });
    expect(requests[1]?.headers).toMatchObject({
      authorization: `Bearer ${MOCK_ACCESS_VALUE}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'LifeOS',
    });
    expect(requests[2]?.headers).toEqual(requests[1]?.headers);
  });

  it('keeps large string subjects and omits unverified email', async () => {
    const execute = vi.fn(async (request: OAuthProviderHttpRequest) => {
      if (request.method === 'POST') {
        return jsonResult({
          access_token: MOCK_ACCESS_VALUE,
          token_type: 'bearer',
        });
      }
      if (request.url.endsWith('/user')) {
        return jsonResult({
          id: '9007199254740993',
          login: 'large-subject',
          name: null,
        });
      }
      return jsonResult([
        {
          email: 'unverified@example.test',
          primary: true,
          verified: false,
        },
      ]);
    });

    await expect(
      createClient(execute).authenticateAuthorizationCode(
        AUTHORIZATION_CODE,
        transaction(),
      ),
    ).resolves.toEqual({
      provider: 'github',
      providerSubject: '9007199254740993',
      displayName: 'large-subject',
    });
  });

  it.each([
    [
      'token rejection',
      async () => jsonResult({ error: 'invalid_grant' }, 401),
    ],
    [
      'malformed user response',
      async (request: OAuthProviderHttpRequest) =>
        request.method === 'POST'
          ? jsonResult({
              access_token: MOCK_ACCESS_VALUE,
              token_type: 'bearer',
            })
          : jsonResult([], 200),
    ],
    [
      'malformed email response',
      async (request: OAuthProviderHttpRequest) => {
        if (request.method === 'POST') {
          return jsonResult({
            access_token: MOCK_ACCESS_VALUE,
            token_type: 'bearer',
          });
        }
        return request.url.endsWith('/user')
          ? jsonResult({ id: 123, login: 'person' })
          : jsonResult({ emails: [] });
      },
    ],
  ])('fails closed for %s', async (_name, execute) => {
    await expect(
      createClient(execute).authenticateAuthorizationCode(
        AUTHORIZATION_CODE,
        transaction(),
      ),
    ).rejects.toThrow('GitHub OAuth authentication failed');
  });

  it('redacts transaction and transport diagnostics', async () => {
    const providerDiagnostic = 'upstream-body-with-sensitive-detail';
    const execute = vi.fn(async () => {
      throw new Error(providerDiagnostic);
    });
    const client = createClient(execute);

    await expect(
      client.authenticateAuthorizationCode(
        AUTHORIZATION_CODE,
        transaction({ provider: 'google' }),
      ),
    ).rejects.toThrow('GitHub OAuth authentication failed');
    expect(execute).not.toHaveBeenCalled();

    const failure = await client
      .authenticateAuthorizationCode(AUTHORIZATION_CODE, transaction())
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).not.toContain(providerDiagnostic);
    expect((failure as Error).message).not.toContain(AUTHORIZATION_CODE);
    expect((failure as Error).message).not.toContain(CLIENT_CREDENTIAL);
    expect((failure as Error).message).not.toContain(CODE_VERIFIER);
  });

  it('rejects invalid configuration before provider access', () => {
    const execute = vi.fn(async () => jsonResult({}));
    expect(
      () =>
        new GitHubOAuthClient({
          clientId: '',
          clientSecret: CLIENT_CREDENTIAL,
          redirectUri: REDIRECT_URI,
          httpClient: { execute },
        }),
    ).toThrow('GitHub OAuth client ID is invalid');
    expect(
      () =>
        new GitHubOAuthClient({
          clientId: CLIENT_ID,
          clientSecret: '',
          redirectUri: REDIRECT_URI,
          httpClient: { execute },
        }),
    ).toThrow('GitHub OAuth client secret is invalid');
    expect(
      () =>
        new GitHubOAuthClient({
          clientId: CLIENT_ID,
          clientSecret: CLIENT_CREDENTIAL,
          redirectUri: 'http://identity.example.test/callback',
          httpClient: { execute },
        }),
    ).toThrow('OAuth redirect URI must use HTTPS except on loopback hosts');
    expect(execute).not.toHaveBeenCalled();
  });
});
