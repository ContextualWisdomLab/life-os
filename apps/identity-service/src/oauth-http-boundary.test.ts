import { describe, expect, it } from 'vitest';
import {
  InMemoryOAuthTransactionRepository,
  InMemorySessionRepository,
  OAuthTransactionService,
  SessionService,
} from './auth-security';
import { OAuthHttpApplication } from './oauth-http-application';
import {
  APPLICATION_SESSION_COOKIE_NAME,
  OAUTH_BROWSER_COOKIE_NAME,
  buildFixedWebRedirect,
  clearApplicationSessionCookie,
  createOAuthBrowserBinding,
  parseCookieHeader,
  parseOAuthCallbackQuery,
  problemDetails,
  readOpaqueCookie,
  serializeApplicationSessionCookie,
  serializeSecureCookie,
  toSessionView,
} from './oauth-http-boundary';

const USER_ID = '123e4567-e89b-42d3-a456-426614174000';
const WORKSPACE_ID = '123e4567-e89b-42d3-b456-426614174001';
const NOW = new Date('2026-08-03T10:00:00.000Z');

function application(): {
  application: OAuthHttpApplication;
  sessions: SessionService;
} {
  const transactions = new OAuthTransactionService(
    new InMemoryOAuthTransactionRepository(),
    { now: () => NOW },
  );
  const sessions = new SessionService(new InMemorySessionRepository(), {
    now: () => NOW,
    ttlMs: 60 * 60 * 1000,
  });
  return {
    application: new OAuthHttpApplication(transactions, sessions, {
      providers: {
        google: {
          clientId: 'google-client',
          redirectUri: 'https://identity.example.com/v1/auth/google/callback',
        },
        github: {
          clientId: 'github-client',
          redirectUri: 'https://identity.example.com/v1/auth/github/callback',
        },
      },
      webOrigin: 'https://life.example.com',
    }),
    sessions,
  };
}

describe('OAuth HTTP cookie boundary', () => {
  it('parses opaque cookies without decoding and rejects duplicate or malformed input', () => {
    expect(parseCookieHeader('alpha=one_two; beta=three-four')).toEqual({
      alpha: 'one_two',
      beta: 'three-four',
    });
    expect(readOpaqueCookie('alpha=one_two', 'alpha')).toBe('one_two');
    expect(() => parseCookieHeader('alpha=one; alpha=two')).toThrow(
      'Cookie header is invalid',
    );
    expect(() => parseCookieHeader('alpha="quoted"')).toThrow(
      'Cookie header is invalid',
    );
    expect(() => parseCookieHeader(`alpha=${'a'.repeat(4097)}`)).toThrow(
      'Cookie header is invalid',
    );
  });

  it('creates a browser binding with strict cookie attributes and auth-only path', () => {
    const binding = createOAuthBrowserBinding();
    expect(binding.browserSessionId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(binding.setCookie).toBe(
      `${OAUTH_BROWSER_COOKIE_NAME}=${binding.browserSessionId}; Path=/v1/auth; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    );
  });

  it('serializes and clears secure application session cookies', () => {
    expect(
      serializeApplicationSessionCookie(
        'opaque_session',
        '2026-08-03T11:00:00.000Z',
        NOW,
      ),
    ).toBe(
      `${APPLICATION_SESSION_COOKIE_NAME}=opaque_session; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(clearApplicationSessionCookie()).toBe(
      `${APPLICATION_SESSION_COOKIE_NAME}=deleted; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    );
    expect(() =>
      serializeSecureCookie({
        name: APPLICATION_SESSION_COOKIE_NAME,
        value: 'not allowed',
        maxAgeSeconds: 10,
      }),
    ).toThrow('Cookie value is invalid');
  });
});

describe('OAuth callback query boundary', () => {
  it('accepts one code and state without retaining unrelated provider data', () => {
    expect(
      parseOAuthCallbackQuery({ code: 'code_value', state: 'state_value' }),
    ).toEqual({
      outcome: 'authorization_code',
      code: 'code_value',
      state: 'state_value',
    });
  });

  it('accepts bounded provider errors and rejects ambiguous, repeated, or unknown input', () => {
    expect(
      parseOAuthCallbackQuery({
        error: 'access_denied',
        error_description: 'User cancelled',
        state: 'state_value',
      }),
    ).toEqual({
      outcome: 'provider_error',
      error: 'access_denied',
      errorDescription: 'User cancelled',
      state: 'state_value',
    });
    expect(() =>
      parseOAuthCallbackQuery({ code: ['one', 'two'], state: 'state_value' }),
    ).toThrow('must appear once');
    expect(() =>
      parseOAuthCallbackQuery({
        code: 'code',
        error: 'denied',
        state: 'state',
      }),
    ).toThrow('OAuth callback is invalid');
    expect(() =>
      parseOAuthCallbackQuery({
        code: 'code',
        state: 'state',
        return_to: 'https://evil.test',
      }),
    ).toThrow('unsupported parameter');
  });
});

describe('OAuthHttpApplication', () => {
  it('starts Google authorization with PKCE, nonce, fixed redirect, and a new binding cookie', async () => {
    const { application: httpApplication } = application();
    const response = await httpApplication.beginAuthorization(
      'google',
      undefined,
    );
    const location = new URL(response.location);

    expect(response.statusCode).toBe(303);
    expect(response.setCookie).toContain(`${OAUTH_BROWSER_COOKIE_NAME}=`);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('google-client');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://identity.example.com/v1/auth/google/callback',
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(
      /^[A-Za-z0-9_-]+$/,
    );
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(location.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('reuses an existing browser binding without rotating it during authorization start', async () => {
    const { application: httpApplication } = application();
    const response = await httpApplication.beginAuthorization(
      'github',
      `${OAUTH_BROWSER_COOKIE_NAME}=existing_binding`,
    );
    const location = new URL(response.location);

    expect(response.setCookie).toBeUndefined();
    expect(location.origin).toBe('https://github.com');
    expect(location.searchParams.get('nonce')).toBeNull();
  });

  it('introspects a server-backed session without returning its bearer token', async () => {
    const { application: httpApplication, sessions } = application();
    const issued = await sessions.create(USER_ID, WORKSPACE_ID);
    const response = await httpApplication.introspectSession(
      `${APPLICATION_SESSION_COOKIE_NAME}=${issued.token}`,
    );

    expect(response).toEqual({
      statusCode: 200,
      body: toSessionView(issued.session),
    });
    expect(JSON.stringify(response)).not.toContain(issued.token);
  });

  it('revokes sessions and clears the cookie idempotently', async () => {
    const { application: httpApplication, sessions } = application();
    const issued = await sessions.create(USER_ID, WORKSPACE_ID);
    const cookie = `${APPLICATION_SESSION_COOKIE_NAME}=${issued.token}`;

    expect(await httpApplication.logout(cookie)).toEqual({
      statusCode: 204,
      setCookie: clearApplicationSessionCookie(),
    });
    await expect(sessions.authenticate(issued.token)).rejects.toThrow(
      'Session is invalid',
    );
    await expect(httpApplication.logout(cookie)).resolves.toEqual({
      statusCode: 204,
      setCookie: clearApplicationSessionCookie(),
    });
    await expect(httpApplication.logout(undefined)).resolves.toEqual({
      statusCode: 204,
      setCookie: clearApplicationSessionCookie(),
    });
  });

  it('uses one configured fixed post-login target and rejects unsafe origins', () => {
    const { application: httpApplication } = application();
    expect(httpApplication.postLoginRedirect()).toBe(
      'https://life.example.com/auth/complete',
    );
    expect(buildFixedWebRedirect('https://life.example.com')).toBe(
      'https://life.example.com/auth/complete',
    );
    expect(() => buildFixedWebRedirect('http://life.example.com')).toThrow(
      'Configured web origin is invalid',
    );
    expect(() =>
      buildFixedWebRedirect('https://life.example.com/other'),
    ).toThrow('Configured web origin is invalid');
  });
});

describe('problemDetails', () => {
  it('creates a stable credential-free RFC 9457-compatible body', () => {
    expect(
      problemDetails(401, 'Authentication required', 'session_invalid'),
    ).toEqual({
      type: 'about:blank',
      title: 'Authentication required',
      status: 401,
      code: 'session_invalid',
    });
    expect(() => problemDetails(200, 'No problem', 'invalid')).toThrow(
      'Problem status is invalid',
    );
  });
});
