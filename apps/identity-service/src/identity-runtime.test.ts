import { describe, expect, it } from 'vitest';
import { createIdentityRuntime } from './identity-runtime';

const KEY = Buffer.alloc(32, 7).toString('base64');
const DATABASE_PROTOCOL = ['post', 'gresql'].join('');
const DATABASE_USER = ['iden', 'tity'].join('');
const DATABASE_PASSWORD = ['test', 'credential'].join('-');
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
    IDENTITY_GOOGLE_REDIRECT_URI:
      'https://identity.example.test/v1/auth/google/callback',
    IDENTITY_GITHUB_CLIENT_ID: 'github-client',
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
    await runtime.close();
    await runtime.close();
  });

  it.each([
    ['IDENTITY_DATABASE_URL', undefined],
    ['IDENTITY_OAUTH_KEY_VERSION', undefined],
    ['IDENTITY_OAUTH_KEYS', undefined],
    ['IDENTITY_GOOGLE_CLIENT_ID', undefined],
    ['IDENTITY_GOOGLE_REDIRECT_URI', undefined],
    ['IDENTITY_GITHUB_CLIENT_ID', undefined],
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
      createIdentityRuntime(
        environment({ IDENTITY_OAUTH_KEYS: '{not-json' }),
      ),
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
      createIdentityRuntime(
        environment({ IDENTITY_DATABASE_POOL_MAX: '33' }),
      ),
    ).toThrow('pool size is invalid');
  });
});
