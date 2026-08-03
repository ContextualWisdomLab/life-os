import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConsumedOAuthTransaction } from '../auth-security';
import { buildGitHubIdentityRequests } from '../oauth-provider-response';
import {
  BoundedOAuthProviderHttpClient,
  type OAuthProviderFetch,
  type OAuthProviderHttpRequest,
} from '../oauth-provider-http-client';
import { buildTokenExchangeRequest } from '../oauth-token-exchange';

const GOOGLE_REDIRECT_URI =
  'https://identity.example.test/v1/auth/google/callback';

/**
 * Builds deterministic, non-production opaque values without embedding credentials.
 */
function syntheticOpaqueValue(variant: string): string {
  const body = Array.from({ length: 48 }, (_, index) =>
    String.fromCharCode(97 + (index % 26)),
  ).join('');
  return `${body}-${variant}`;
}

function googleTransaction(): ConsumedOAuthTransaction {
  return {
    id: '24b4d4d5-c5c0-4df4-a863-5239d263e36e',
    provider: 'google',
    codeVerifier: syntheticOpaqueValue('pkce-verifier'),
    redirectUri: GOOGLE_REDIRECT_URI,
    nonce: syntheticOpaqueValue('oidc-nonce'),
  };
}

function googleTokenRequest(): OAuthProviderHttpRequest {
  return buildTokenExchangeRequest(
    'google',
    {
      clientId: 'google-client-id',
      clientSecret: syntheticOpaqueValue('provider-client-credential'),
      redirectUri: GOOGLE_REDIRECT_URI,
    },
    syntheticOpaqueValue('authorization-code'),
    googleTransaction(),
  );
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...init.headers,
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('BoundedOAuthProviderHttpClient', () => {
  it('executes an exact token request without redirects or ambient credentials', async () => {
    const fetchFunction: OAuthProviderFetch = vi.fn(async (_input, init) => {
      expect(init.method).toBe('POST');
      expect(init.redirect).toBe('error');
      expect(init.credentials).toBe('omit');
      expect(init.cache).toBe('no-store');
      expect(init.referrerPolicy).toBe('no-referrer');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return jsonResponse({ token_type: 'bearer' });
    });
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    const result = await client.execute(googleTokenRequest());

    expect(fetchFunction).toHaveBeenCalledOnce();
    expect(fetchFunction).toHaveBeenCalledWith(
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    );
    expect(result).toEqual({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ token_type: 'bearer' }),
    });
  });

  it('accepts the fixed GitHub identity request builders', async () => {
    const providerCredential = syntheticOpaqueValue('github-access');
    const requests = buildGitHubIdentityRequests(providerCredential);
    const fetchFunction: OAuthProviderFetch = vi.fn(async (input) =>
      input.endsWith('/emails') ? jsonResponse([]) : jsonResponse({ id: 42 }),
    );
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    await expect(client.execute(requests.user)).resolves.toMatchObject({
      status: 200,
    });
    await expect(client.execute(requests.emails)).resolves.toMatchObject({
      status: 200,
    });
    expect(fetchFunction).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/user',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchFunction).toHaveBeenNthCalledWith(
      2,
      'https://api.github.com/user/emails',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it.each([
    {
      name: 'query-bearing endpoint',
      request: {
        url: 'https://api.github.com/user?target=https://example.test',
        method: 'GET' as const,
        headers: {},
      },
    },
    {
      name: 'unapproved endpoint',
      request: {
        url: 'https://api.github.com/repos/example/private',
        method: 'GET' as const,
        headers: {},
      },
    },
    {
      name: 'ambient cookie header',
      request: {
        ...buildGitHubIdentityRequests(
          syntheticOpaqueValue('github-extra-header'),
        ).user,
        headers: {
          ...buildGitHubIdentityRequests(
            syntheticOpaqueValue('github-extra-header'),
          ).user.headers,
          cookie: 'life_os_session=not-forwarded',
        },
      },
    },
    {
      name: 'body on a GET request',
      request: {
        ...buildGitHubIdentityRequests(syntheticOpaqueValue('github-get-body'))
          .user,
        body: 'unexpected=true',
      },
    },
  ])('rejects a $name before network access', async ({ request }) => {
    const fetchFunction: OAuthProviderFetch = vi.fn(async () =>
      jsonResponse({}),
    );
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    await expect(client.execute(request)).rejects.toThrow(
      'OAuth provider request failed',
    );
    expect(fetchFunction).not.toHaveBeenCalled();
  });

  it('rejects redirects, non-JSON responses, and oversized response streams generically', async () => {
    const responses = [
      new Response('', {
        status: 302,
        headers: {
          location: 'https://attacker.example.test',
          'content-type': 'application/json',
        },
      }),
      new Response('<html>upstream failure</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
      jsonResponse({ value: 'x'.repeat(64 * 1024) }),
    ];
    const fetchFunction: OAuthProviderFetch = vi.fn(async () => {
      const response = responses.shift();
      if (!response) {
        throw new Error('unexpected test request');
      }
      return response;
    });
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    await expect(client.execute(googleTokenRequest())).rejects.toThrow(
      'OAuth provider request failed',
    );
    await expect(client.execute(googleTokenRequest())).rejects.toThrow(
      'OAuth provider request failed',
    );
    await expect(client.execute(googleTokenRequest())).rejects.toThrow(
      'OAuth provider request failed',
    );
  });

  it('aborts an upstream request at the configured deadline', async () => {
    vi.useFakeTimers();
    const fetchFunction: OAuthProviderFetch = vi.fn(
      async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          const signal = init.signal;
          if (!signal) {
            reject(new Error('missing abort signal'));
            return;
          }
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const client = new BoundedOAuthProviderHttpClient({
      fetchFunction,
      timeoutMs: 100,
    });

    const pendingRequest = client.execute(googleTokenRequest());
    const assertion = expect(pendingRequest).rejects.toThrow(
      'OAuth provider request failed',
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;

    const init = vi.mocked(fetchFunction).mock.calls[0]?.[1];
    expect(init?.signal?.aborted).toBe(true);
  });

  it('never includes provider request material in failures', async () => {
    const providerCredential = syntheticOpaqueValue('failure-redaction');
    const request = buildGitHubIdentityRequests(providerCredential).user;
    const fetchFunction: OAuthProviderFetch = vi.fn(async () => {
      throw new Error(`upstream exposed ${providerCredential}`);
    });
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    await expect(client.execute(request)).rejects.toEqual(
      new Error('OAuth provider request failed'),
    );
  });

  it('rejects unsafe timeout configuration', () => {
    expect(() => new BoundedOAuthProviderHttpClient({ timeoutMs: 99 })).toThrow(
      'OAuth provider request failed',
    );
    expect(
      () => new BoundedOAuthProviderHttpClient({ timeoutMs: 10_001 }),
    ).toThrow('OAuth provider request failed');
  });
});
