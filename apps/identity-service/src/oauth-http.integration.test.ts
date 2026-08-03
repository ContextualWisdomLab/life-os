import type { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  InMemoryOAuthTransactionRepository,
  InMemorySessionRepository,
  OAuthTransactionService,
  SessionService,
} from './auth-security';
import {
  IdentityService,
  InMemoryIdentityRepository,
} from './identity-domain';
import {
  OAuthCallbackApplication,
  type OAuthCallbackAuditEvent,
} from './oauth-callback-application';
import { OAuthHttpApplication } from './oauth-http-application';
import {
  OAUTH_CALLBACK_APPLICATION,
  OAUTH_HTTP_APPLICATION,
  OAuthHttpController,
} from './oauth-http-controller';

const NOW = new Date('2026-08-03T15:00:00.000Z');
const WEB_ORIGIN = 'https://app.example.test';
const GOOGLE_REDIRECT_URI =
  'https://identity.example.test/v1/auth/google/callback';
const GITHUB_REDIRECT_URI =
  'https://identity.example.test/v1/auth/github/callback';
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface TestHarness {
  app: INestApplication;
  baseUrl: string;
  auditEvents: OAuthCallbackAuditEvent[];
  googleAuthenticate: ReturnType<typeof vi.fn>;
  githubAuthenticate: ReturnType<typeof vi.fn>;
}

const activeApplications: INestApplication[] = [];

function cookiePair(setCookie: string | null): string {
  if (!setCookie) {
    throw new Error('Expected Set-Cookie header');
  }
  return setCookie.split(';', 1)[0] as string;
}

function callbackState(location: string | null): string {
  if (!location) {
    throw new Error('Expected authorization redirect');
  }
  const state = new URL(location).searchParams.get('state');
  if (!state) {
    throw new Error('Expected OAuth state');
  }
  return state;
}

async function request(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return await fetch(`${baseUrl}${path}`, {
    ...init,
    redirect: 'manual',
  });
}

async function createHarness(): Promise<TestHarness> {
  const transactions = new OAuthTransactionService(
    new InMemoryOAuthTransactionRepository(),
    { now: () => NOW },
  );
  const sessions = new SessionService(new InMemorySessionRepository(), {
    now: () => NOW,
  });
  const identities = new IdentityService(new InMemoryIdentityRepository());
  const auditEvents: OAuthCallbackAuditEvent[] = [];
  const googleAuthenticate = vi.fn(async () => ({
    provider: 'google' as const,
    subject: 'google-subject-integration',
    issuer: 'https://accounts.google.com' as const,
    email: 'integration@example.test',
    emailVerified: true,
    displayName: 'Google Integration User',
  }));
  const githubAuthenticate = vi.fn(async () => ({
    provider: 'github' as const,
    providerSubject: '9007199254740993',
    displayName: 'GitHub Integration User',
    verifiedEmail: 'integration@example.test',
  }));
  const httpApplication = new OAuthHttpApplication(transactions, sessions, {
    providers: {
      google: {
        clientId: 'google-integration-client',
        redirectUri: GOOGLE_REDIRECT_URI,
      },
      github: {
        clientId: 'github-integration-client',
        redirectUri: GITHUB_REDIRECT_URI,
      },
    },
    webOrigin: WEB_ORIGIN,
  });
  const callbackApplication = new OAuthCallbackApplication(
    transactions,
    identities,
    sessions,
    {
      google: { authenticateAuthorizationCode: googleAuthenticate },
      github: { authenticateAuthorizationCode: githubAuthenticate },
    },
    {
      record(event): void {
        auditEvents.push({ ...event });
      },
    },
    { webOrigin: WEB_ORIGIN, now: () => NOW },
  );

  class OAuthHttpIntegrationModule {}
  Module({
    controllers: [OAuthHttpController],
    providers: [
      { provide: OAUTH_HTTP_APPLICATION, useValue: httpApplication },
      { provide: OAUTH_CALLBACK_APPLICATION, useValue: callbackApplication },
    ],
  })(OAuthHttpIntegrationModule);

  const app = await NestFactory.create(OAuthHttpIntegrationModule, {
    logger: false,
  });
  await app.listen(0, '127.0.0.1');
  activeApplications.push(app);
  const address = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    baseUrl: `http://127.0.0.1:${address.port}`,
    auditEvents,
    googleAuthenticate,
    githubAuthenticate,
  };
}

afterEach(async () => {
  await Promise.all(activeApplications.splice(0).map((app) => app.close()));
});

describe('OAuth HTTP integration', () => {
  it('completes the Google browser-session lifecycle over HTTP', async () => {
    const harness = await createHarness();

    const start = await request(harness.baseUrl, '/v1/auth/google/start');
    expect(start.status).toBe(303);
    expect(start.headers.get('cache-control')).toBe('no-store');
    expect(start.headers.get('location')).toContain(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    const browserSetCookie = start.headers.get('set-cookie');
    expect(browserSetCookie).toContain('Path=/v1/auth');
    expect(browserSetCookie).toContain('HttpOnly; Secure; SameSite=Lax');
    const browserCookie = cookiePair(browserSetCookie);
    const state = callbackState(start.headers.get('location'));

    const callback = await request(
      harness.baseUrl,
      `/v1/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: browserCookie } },
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get('cache-control')).toBe('no-store');
    expect(callback.headers.get('location')).toBe(
      'https://app.example.test/auth/complete',
    );
    const correlationId = callback.headers.get('x-correlation-id');
    expect(correlationId).toMatch(UUID_V4_PATTERN);
    const sessionSetCookie = callback.headers.get('set-cookie');
    expect(sessionSetCookie).toContain('Path=/');
    expect(sessionSetCookie).toContain('HttpOnly; Secure; SameSite=Lax');
    const sessionCookie = cookiePair(sessionSetCookie);
    const sessionToken = sessionCookie.split('=', 2)[1] as string;

    const session = await request(harness.baseUrl, '/v1/session', {
      headers: { cookie: sessionCookie },
    });
    expect(session.status).toBe(200);
    expect(session.headers.get('cache-control')).toBe('no-store');
    const sessionBody = await session.json();
    expect(sessionBody).toMatchObject({
      sessionId: expect.stringMatching(UUID_V4_PATTERN),
      userId: expect.stringMatching(UUID_V4_PATTERN),
      workspaceId: expect.stringMatching(UUID_V4_PATTERN),
    });
    const serializedSession = JSON.stringify(sessionBody);
    expect(serializedSession).not.toContain(sessionToken);
    expect(serializedSession).not.toContain('google-code');
    expect(serializedSession).not.toContain(state);

    const replay = await request(
      harness.baseUrl,
      `/v1/auth/google/callback?code=google-code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: browserCookie } },
    );
    expect(replay.status).toBe(400);
    expect(await replay.json()).toMatchObject({
      status: 400,
      code: 'oauth_callback_failed',
    });

    const logout = await request(harness.baseUrl, '/v1/auth/logout', {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain(
      'life_os_session=deleted; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
    );

    const repeatedLogout = await request(
      harness.baseUrl,
      '/v1/auth/logout',
      { method: 'POST', headers: { cookie: sessionCookie } },
    );
    expect(repeatedLogout.status).toBe(204);

    const revokedSession = await request(harness.baseUrl, '/v1/session', {
      headers: { cookie: sessionCookie },
    });
    expect(revokedSession.status).toBe(401);
    expect(await revokedSession.json()).toMatchObject({
      status: 401,
      code: 'authentication_required',
    });
    expect(harness.googleAuthenticate).toHaveBeenCalledTimes(1);
    expect(harness.auditEvents).toEqual([
      expect.objectContaining({
        provider: 'google',
        outcome: 'success',
        correlationId,
      }),
      {
        provider: 'google',
        outcome: 'failure',
        correlationId: expect.stringMatching(UUID_V4_PATTERN),
      },
    ]);
  });

  it('binds GitHub callbacks to the initiating browser', async () => {
    const harness = await createHarness();
    const start = await request(harness.baseUrl, '/v1/auth/github/start');
    const browserCookie = cookiePair(start.headers.get('set-cookie'));
    const state = callbackState(start.headers.get('location'));
    const wrongBrowserCookie = `life_os_oauth_browser=${'x'.repeat(43)}`;
    const callbackPath = `/v1/auth/github/callback?code=github-code&state=${encodeURIComponent(state)}`;

    const rejected = await request(harness.baseUrl, callbackPath, {
      headers: { cookie: wrongBrowserCookie },
    });
    expect(rejected.status).toBe(400);
    expect(harness.githubAuthenticate).not.toHaveBeenCalled();

    const accepted = await request(harness.baseUrl, callbackPath, {
      headers: {
        cookie: browserCookie,
        'x-correlation-id': 'github-integration-correlation',
      },
    });
    expect(accepted.status).toBe(303);
    expect(accepted.headers.get('location')).toBe(
      'https://app.example.test/auth/complete',
    );
    expect(accepted.headers.get('x-correlation-id')).toBe(
      'github-integration-correlation',
    );
    expect(harness.githubAuthenticate).toHaveBeenCalledTimes(1);
    expect(harness.auditEvents).toEqual([
      {
        provider: 'github',
        outcome: 'failure',
        correlationId: expect.stringMatching(UUID_V4_PATTERN),
      },
      expect.objectContaining({
        provider: 'github',
        outcome: 'success',
        correlationId: 'github-integration-correlation',
      }),
    ]);
  });
});
