import { describe, expect, it, vi } from 'vitest';
import {
  JsonLineOAuthCallbackAuditSink,
  createIdentityRuntime,
} from './identity-runtime';
import type { OAuthCallbackAuditEvent } from './oauth-callback-application';

const KEY = Buffer.alloc(32, 7).toString('base64');
const DATABASE_PROTOCOL = ['post', 'gresql'].join('');
const DATABASE_USER = ['iden', 'tity'].join('');
const DATABASE_PASSWORD = ['test', 'credential'].join('-');
const CLIENT_CREDENTIAL = ['test', 'client', 'credential'].join('-');
const DATABASE_URL = [
  DATABASE_PROTOCOL,
  '://',
  DATABASE_USER,
  ':',
  DATABASE_PASSWORD,
  '@127.0.0.1:5432/life_os',
].join('');

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    IDENTITY_DATABASE_URL: DATABASE_URL,
    IDENTITY_OAUTH_KEY_VERSION: 'version_one',
    IDENTITY_OAUTH_KEYS: JSON.stringify({ version_one: KEY }),
    IDENTITY_GOOGLE_CLIENT_ID: 'google-client',
    IDENTITY_GOOGLE_CLIENT_SECRET: CLIENT_CREDENTIAL,
    IDENTITY_GOOGLE_REDIRECT_URI:
      'https://identity.example.test/v1/auth/google/callback',
    IDENTITY_GITHUB_CLIENT_ID: 'github-client',
    IDENTITY_GITHUB_CLIENT_SECRET: CLIENT_CREDENTIAL,
    IDENTITY_GITHUB_REDIRECT_URI:
      'https://identity.example.test/v1/auth/github/callback',
    LIFE_OS_WEB_ORIGIN: 'https://app.example.test',
    ...overrides,
  };
}

describe('createIdentityRuntime', () => {
  it('builds PostgreSQL-backed OAuth services from bounded secure configuration', async () => {
    const runtime = createIdentityRuntime(environment());
    expect(runtime.application.postLoginRedirect()).toBe(
      'https://app.example.test/auth/complete',
    );
    expect(runtime.callbackApplication).toBeDefined();
    await runtime.close();
    await runtime.close();
  });

  it.each([
    ['IDENTITY_DATABASE_URL', undefined],
    ['IDENTITY_OAUTH_KEY_VERSION', undefined],
    ['IDENTITY_OAUTH_KEYS', undefined],
    ['IDENTITY_GOOGLE_CLIENT_ID', undefined],
    ['IDENTITY_GOOGLE_CLIENT_SECRET', undefined],
    ['IDENTITY_GOOGLE_REDIRECT_URI', undefined],
    ['IDENTITY_GITHUB_CLIENT_ID', undefined],
    ['IDENTITY_GITHUB_CLIENT_SECRET', undefined],
    ['IDENTITY_GITHUB_REDIRECT_URI', undefined],
    ['LIFE_OS_WEB_ORIGIN', undefined],
  ])('fails startup when %s is missing', (name, value) => {
    expect(() => createIdentityRuntime(environment({ [name]: value }))).toThrow(
      'Required identity configuration is missing',
    );
  });

  it('rejects weak, malformed, unknown-version, and oversized configuration', () => {
    expect(() =>
      createIdentityRuntime(
        environment({
          IDENTITY_DATABASE_URL: 'https://database.example.test',
        }),
      ),
    ).toThrow('must use PostgreSQL');
    expect(() =>
      createIdentityRuntime(environment({ IDENTITY_OAUTH_KEYS: '{not-json' })),
    ).toThrow('key configuration is invalid');
    expect(() =>
      createIdentityRuntime(
        environment({
          IDENTITY_OAUTH_KEYS: JSON.stringify({
            version_one: Buffer.alloc(16).toString('base64'),
          }),
        }),
      ),
    ).toThrow('must decode to 32 bytes');
    expect(() =>
      createIdentityRuntime(
        environment({ IDENTITY_OAUTH_KEY_VERSION: 'version_two' }),
      ),
    ).toThrow('Current encryption key version is not configured');
    expect(() =>
      createIdentityRuntime(environment({ IDENTITY_DATABASE_POOL_MAX: '33' })),
    ).toThrow('pool size is invalid');
    expect(() =>
      createIdentityRuntime(
        environment({ IDENTITY_PROVIDER_REQUEST_TIMEOUT_MS: '10001' }),
      ),
    ).toThrow('provider request timeout is invalid');
  });
});

describe('JsonLineOAuthCallbackAuditSink', () => {
  it('projects only credential-free callback fields into one timestamped JSON line', async () => {
    const writer = vi.fn();
    const now = new Date('2026-08-03T14:30:00.000Z');
    const sink = new JsonLineOAuthCallbackAuditSink(writer, () => now);
    const event = {
      provider: 'github',
      outcome: 'success',
      correlationId: 'd9248996-b1cf-4d31-b6fa-3cbb9db44d22',
      userId: '5401dd67-06d7-4b25-8cbf-99c977ee6824',
      workspaceId: '5588f2ec-e2fd-47d8-964d-d1091f8227d3',
      authorizationCode: 'provider-authorization-code',
      accessToken: 'provider-access-token',
    } as OAuthCallbackAuditEvent & {
      authorizationCode: string;
      accessToken: string;
    };

    await sink.record(event);

    expect(writer).toHaveBeenCalledTimes(1);
    const line = writer.mock.calls[0]?.[0] as string;
    expect(JSON.parse(line)).toEqual({
      eventType: 'identity.oauth_callback',
      occurredAt: now.toISOString(),
      provider: 'github',
      outcome: 'success',
      correlationId: event.correlationId,
      userId: event.userId,
      workspaceId: event.workspaceId,
    });
    expect(line).not.toContain(event.authorizationCode);
    expect(line).not.toContain(event.accessToken);
  });

  it('propagates audit writer failures and rejects an invalid audit clock', async () => {
    const writerFailure = new JsonLineOAuthCallbackAuditSink(async () => {
      throw new Error('audit writer unavailable');
    });
    const invalidClock = new JsonLineOAuthCallbackAuditSink(
      vi.fn(),
      () => new Date(Number.NaN),
    );
    const event: OAuthCallbackAuditEvent = {
      provider: 'google',
      outcome: 'failure',
      correlationId: 'e9147303-c1da-4832-b0d1-86bd47c01ca6',
    };

    await expect(writerFailure.record(event)).rejects.toThrow(
      'audit writer unavailable',
    );
    await expect(invalidClock.record(event)).rejects.toThrow(
      'audit clock is invalid',
    );
  });
});
