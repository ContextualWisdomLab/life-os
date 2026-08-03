import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  GoogleOidcClient,
  type FixedEndpointFetch,
  type FixedEndpointFetchInit,
} from './google-oidc-client';

const NOW = new Date('2026-08-03T12:00:00.000Z');
const CLIENT_ID = 'life-os-google-client';
const CLIENT_CREDENTIAL = ['confidential', 'client', 'credential'].join('-');
const MOCK_ACCESS_VALUE = ['mock', 'access', 'value'].join('-');
const MOCK_REFRESH_VALUE = ['mock', 'refresh', 'value'].join('-');
const REDIRECT_URI = 'https://identity.example.test/v1/auth/google/callback';
const CODE_VERIFIER = 'v'.repeat(43);
const NONCE = 'n'.repeat(43);
const AUTHORIZATION_CODE = 'authorization-code';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';

class TestHeaders {
  private readonly values: ReadonlyMap<string, string>;

  constructor(values: Record<string, string> = {}) {
    this.values = new Map(
      Object.entries(values).map(([name, value]) => [
        name.toLowerCase(),
        value,
      ]),
    );
  }

  get(name: string): string | null {
    return this.values.get(name.toLowerCase()) ?? null;
  }
}

function jsonResponse(
  body: unknown,
  options: {
    status?: number;
    headers?: Record<string, string>;
    rawBody?: string;
  } = {},
) {
  const text = options.rawBody ?? JSON.stringify(body);
  return {
    status: options.status ?? 200,
    headers: new TestHeaders(options.headers),
    body: null,
    async text(): Promise<string> {
      return text;
    },
  };
}

function keyFixture(
  kid: string,
  modulusLength = 2_048,
): {
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
} {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength,
  });
  return {
    privateKey,
    jwk: {
      ...publicKey.export({ format: 'jwk' }),
      kid,
      alg: 'RS256',
      use: 'sig',
      key_ops: ['verify'],
    },
  };
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signIdToken(
  privateKey: KeyObject,
  claims: Record<string, unknown>,
  header: Record<string, unknown> = {},
): string {
  const encodedHeader = encodeJson({
    alg: 'RS256',
    typ: 'JWT',
    kid: 'key-one',
    ...header,
  });
  const encodedClaims = encodeJson(claims);
  const signedContent = `${encodedHeader}.${encodedClaims}`;
  const signature = sign(
    'RSA-SHA256',
    Buffer.from(signedContent, 'ascii'),
    privateKey,
  ).toString('base64url');
  return `${signedContent}.${signature}`;
}

function validClaims(overrides: Record<string, unknown> = {}) {
  const nowSeconds = Math.floor(NOW.getTime() / 1_000);
  return {
    iss: 'https://accounts.google.com',
    sub: '107691503500061507151',
    aud: CLIENT_ID,
    azp: CLIENT_ID,
    iat: nowSeconds,
    exp: nowSeconds + 3_600,
    nonce: NONCE,
    email: 'person@example.test',
    email_verified: true,
    name: 'Example Person',
    hd: 'example.test',
    ...overrides,
  };
}

function createClient(
  fetcher: FixedEndpointFetch,
  overrides: Partial<ConstructorParameters<typeof GoogleOidcClient>[0]> = {},
): GoogleOidcClient {
  return new GoogleOidcClient({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    fetch: fetcher,
    now: () => NOW,
    ...overrides,
  });
}

function authenticationInput() {
  return {
    code: AUTHORIZATION_CODE,
    codeVerifier: CODE_VERIFIER,
    nonce: NONCE,
  };
}

describe('GoogleOidcClient', () => {
  it('exchanges a code at the fixed endpoint and returns only verified identity claims', async () => {
    const key = keyFixture('key-one');
    const idToken = signIdToken(key.privateKey, validClaims());
    const calls: Array<{ url: string; init: FixedEndpointFetchInit }> = [];
    const fetcher: FixedEndpointFetch = vi.fn(async (url, init) => {
      calls.push({ url, init });
      if (url === TOKEN_ENDPOINT) {
        return jsonResponse({
          access_token: MOCK_ACCESS_VALUE,
          refresh_token: MOCK_REFRESH_VALUE,
          token_type: 'Bearer',
          expires_in: 3_600,
          id_token: idToken,
        });
      }
      if (url === JWKS_ENDPOINT) {
        return jsonResponse(
          { keys: [key.jwk] },
          { headers: { 'cache-control': 'public, max-age=600' } },
        );
      }
      throw new Error('unexpected endpoint');
    });

    const identity = await createClient(fetcher, {
      clientSecret: CLIENT_CREDENTIAL,
    }).authenticateAuthorizationCode(authenticationInput());

    expect(identity).toEqual({
      provider: 'google',
      subject: '107691503500061507151',
      issuer: 'https://accounts.google.com',
      email: 'person@example.test',
      emailVerified: true,
      displayName: 'Example Person',
      hostedDomain: 'example.test',
    });
    expect(JSON.stringify(identity)).not.toContain(MOCK_ACCESS_VALUE);
    expect(JSON.stringify(identity)).not.toContain(MOCK_REFRESH_VALUE);
    expect(calls.map((call) => call.url)).toEqual([
      TOKEN_ENDPOINT,
      JWKS_ENDPOINT,
    ]);
    expect(calls[0]?.init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    const form = new URLSearchParams(calls[0]?.init.body);
    expect(Object.fromEntries(form)).toEqual({
      client_id: CLIENT_ID,
      client_secret: CLIENT_CREDENTIAL,
      code: AUTHORIZATION_CODE,
      code_verifier: CODE_VERIFIER,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
    });
    expect(calls[1]?.init).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
  });

  it('caches signing keys and refreshes once when Google rotates to an unknown kid', async () => {
    const firstKey = keyFixture('key-one');
    const secondKey = keyFixture('key-two');
    const tokens = [
      signIdToken(firstKey.privateKey, validClaims()),
      signIdToken(secondKey.privateKey, validClaims(), { kid: 'key-two' }),
      signIdToken(firstKey.privateKey, validClaims()),
    ];
    let tokenRequests = 0;
    let keyRequests = 0;
    const fetcher: FixedEndpointFetch = async (url) => {
      if (url === TOKEN_ENDPOINT) {
        const idToken = tokens[tokenRequests];
        tokenRequests += 1;
        return jsonResponse({ id_token: idToken });
      }
      if (url === JWKS_ENDPOINT) {
        keyRequests += 1;
        return jsonResponse(
          {
            keys:
              keyRequests === 1
                ? [firstKey.jwk]
                : [firstKey.jwk, secondKey.jwk],
          },
          { headers: { 'cache-control': 'max-age=3600' } },
        );
      }
      throw new Error('unexpected endpoint');
    };
    const client = createClient(fetcher);

    await expect(
      client.authenticateAuthorizationCode(authenticationInput()),
    ).resolves.toMatchObject({ subject: '107691503500061507151' });
    await expect(
      client.authenticateAuthorizationCode(authenticationInput()),
    ).resolves.toMatchObject({ subject: '107691503500061507151' });
    await expect(
      client.authenticateAuthorizationCode({
        ...authenticationInput(),
        code: `${AUTHORIZATION_CODE}-cached`,
      }),
    ).resolves.toMatchObject({ subject: '107691503500061507151' });

    expect(tokenRequests).toBe(3);
    expect(keyRequests).toBe(2);
  });

  it('shares an in-flight signing key fetch across concurrent authentications', async () => {
    const key = keyFixture('key-one');
    const idToken = signIdToken(key.privateKey, validClaims());
    let tokenRequests = 0;
    let keyRequests = 0;
    let releaseKeySet: (() => void) | undefined;
    let markKeyFetchStarted: (() => void) | undefined;
    const keySetGate = new Promise<void>((resolve) => {
      releaseKeySet = resolve;
    });
    const keyFetchStarted = new Promise<void>((resolve) => {
      markKeyFetchStarted = resolve;
    });
    const fetcher: FixedEndpointFetch = async (url) => {
      if (url === TOKEN_ENDPOINT) {
        tokenRequests += 1;
        return jsonResponse({ id_token: idToken });
      }
      if (url === JWKS_ENDPOINT) {
        keyRequests += 1;
        markKeyFetchStarted?.();
        await keySetGate;
        return jsonResponse(
          { keys: [key.jwk] },
          { headers: { 'cache-control': 'max-age=3600' } },
        );
      }
      throw new Error('unexpected endpoint');
    };
    const client = createClient(fetcher);

    const authentications = [
      client.authenticateAuthorizationCode({
        ...authenticationInput(),
        code: `${AUTHORIZATION_CODE}-one`,
      }),
      client.authenticateAuthorizationCode({
        ...authenticationInput(),
        code: `${AUTHORIZATION_CODE}-two`,
      }),
    ];

    await keyFetchStarted;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(keyRequests).toBe(1);
    releaseKeySet?.();
    await expect(Promise.all(authentications)).resolves.toHaveLength(2);
    expect(tokenRequests).toBe(2);
    expect(keyRequests).toBe(1);
  });

  it.each([
    ['issuer', { iss: 'https://attacker.example' }],
    ['audience', { aud: 'another-client' }],
    ['authorized presenter', { azp: 'another-client' }],
    ['expiration', { exp: Math.floor(NOW.getTime() / 1_000) - 61 }],
    ['issued-at time', { iat: Math.floor(NOW.getTime() / 1_000) + 61 }],
    ['not-before time', { nbf: Math.floor(NOW.getTime() / 1_000) + 61 }],
    ['nonce', { nonce: 'different-nonce' }],
    ['subject', { sub: 'bad\nsubject' }],
    ['email verification type', { email_verified: 'true' }],
  ])(
    'rejects an ID token with an invalid %s claim',
    async (_name, override) => {
      const key = keyFixture('key-one');
      const idToken = signIdToken(key.privateKey, validClaims(override));
      const fetcher: FixedEndpointFetch = async (url) =>
        url === TOKEN_ENDPOINT
          ? jsonResponse({ id_token: idToken })
          : jsonResponse({ keys: [key.jwk] });

      await expect(
        createClient(fetcher).authenticateAuthorizationCode(
          authenticationInput(),
        ),
      ).rejects.toThrow('Google ID token claims are invalid');
    },
  );

  it('rejects algorithm confusion, forged signatures, and malformed key sets', async () => {
    const trustedKey = keyFixture('key-one');
    const attackerKey = keyFixture('key-attacker');
    const invalidTokens = [
      signIdToken(trustedKey.privateKey, validClaims(), { alg: 'HS256' }),
      signIdToken(attackerKey.privateKey, validClaims()),
    ];

    for (const idToken of invalidTokens) {
      const fetcher: FixedEndpointFetch = async (url) =>
        url === TOKEN_ENDPOINT
          ? jsonResponse({ id_token: idToken })
          : jsonResponse({ keys: [trustedKey.jwk] });
      await expect(
        createClient(fetcher).authenticateAuthorizationCode(
          authenticationInput(),
        ),
      ).rejects.toThrow('Google ID token is invalid');
    }

    const duplicateKeys: FixedEndpointFetch = async (url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse({
            id_token: signIdToken(trustedKey.privateKey, validClaims()),
          })
        : jsonResponse({ keys: [trustedKey.jwk, trustedKey.jwk] });
    await expect(
      createClient(duplicateKeys).authenticateAuthorizationCode(
        authenticationInput(),
      ),
    ).rejects.toThrow('Google signing key set is invalid');

    const weakKey = keyFixture('key-weak', 1_024);
    const weakKeySet: FixedEndpointFetch = async (url) =>
      url === TOKEN_ENDPOINT
        ? jsonResponse({
            id_token: signIdToken(weakKey.privateKey, validClaims(), {
              kid: 'key-weak',
            }),
          })
        : jsonResponse({ keys: [weakKey.jwk] });
    await expect(
      createClient(weakKeySet).authenticateAuthorizationCode(
        authenticationInput(),
      ),
    ).rejects.toThrow('Google signing key set is invalid');
  });

  it('fails closed before network access for invalid PKCE and configuration', async () => {
    const fetcher: FixedEndpointFetch = vi.fn(async () => jsonResponse({}));
    await expect(
      createClient(fetcher).authenticateAuthorizationCode({
        ...authenticationInput(),
        codeVerifier: 'too-short',
      }),
    ).rejects.toThrow('Google PKCE verifier is invalid');
    expect(fetcher).not.toHaveBeenCalled();

    expect(() =>
      createClient(fetcher, {
        redirectUri: 'http://identity.example.test/callback',
      }),
    ).toThrow('OAuth redirect URI must use HTTPS except on loopback hosts');
    expect(() => createClient(fetcher, { requestTimeoutMs: 99 })).toThrow(
      'Google request timeout is invalid',
    );
    expect(() => createClient(fetcher, { clockSkewSeconds: 301 })).toThrow(
      'Google token clock skew is invalid',
    );
  });

  it('never exposes provider error bodies and rejects oversized responses', async () => {
    const providerError: FixedEndpointFetch = async () =>
      jsonResponse(
        { error: 'invalid_grant', error_description: 'secret-provider-detail' },
        { status: 400 },
      );
    await expect(
      createClient(providerError).authenticateAuthorizationCode(
        authenticationInput(),
      ),
    ).rejects.toThrow('Google token exchange failed');
    await expect(
      createClient(providerError).authenticateAuthorizationCode(
        authenticationInput(),
      ),
    ).rejects.not.toThrow('secret-provider-detail');

    const oversized: FixedEndpointFetch = async () =>
      jsonResponse(
        {},
        { headers: { 'content-length': String(64 * 1_024 + 1) } },
      );
    await expect(
      createClient(oversized).authenticateAuthorizationCode(
        authenticationInput(),
      ),
    ).rejects.toThrow('Google identity provider response is invalid');
  });

  it('cancels a chunked provider response when it exceeds the byte limit', async () => {
    const cancel = vi.fn();
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1_024 + 1));
      },
      cancel,
    });
    const oversizedStream: FixedEndpointFetch = async () => ({
      status: 200,
      headers: new TestHeaders(),
      body: responseBody,
      async text(): Promise<string> {
        throw new Error('streaming response must not use text()');
      },
    });

    await expect(
      createClient(oversizedStream).authenticateAuthorizationCode(
        authenticationInput(),
      ),
    ).rejects.toThrow('Google identity provider response is invalid');
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('turns transport failures into a stable provider error', async () => {
    const fetcher: FixedEndpointFetch = async () => {
      throw new Error('socket failure with sensitive diagnostics');
    };
    await expect(
      createClient(fetcher).authenticateAuthorizationCode(
        authenticationInput(),
      ),
    ).rejects.toThrow('Google identity provider request failed');
  });
});
