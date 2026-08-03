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
    let capturedInit: RequestInit | undefined;
    const fetchFunction: OAuthProviderFetch = vi.fn(async (_input, init) => {
      capturedInit = init;
      return jsonResponse({ token_type: 'bearer' });
    });
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    const result = await client.execute(googleTokenRequest());

    expect(capturedInit).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
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
        ...buildGitHubIdentityRequests(
          syntheticOpaqueValue('github-query-endpoint'),
        ).user,
        url: 'https://api.github.com/user?target=https://example.test',
      },
    },
    {
      name: 'unapproved endpoint',
      request: {
        ...buildGitHubIdentityRequests(
          syntheticOpaqueValue('github-unapproved-endpoint'),
        ).user,
        url: 'https://api.github.com/repos/example/private',
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

  it('rejects redirect status responses generically', async () => {
    const fetchFunction: OAuthProviderFetch = vi.fn(async () =>
      new Response('', {
        status: 302,
        headers: {
          location: 'https://attacker.example.test',
          'content-type': 'application/json',
        },
      }),
    );
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    await expect(client.execute(googleTokenRequest())).rejects.toThrow(
      'OAuth provider request failed',
    );
  });

  it('rejects non-JSON provider responses generically', async () => {
    const fetchFunction: OAuthProviderFetch = vi.fn(async () =>
      new Response('<html>upstream failure</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    await expect(client.execute(googleTokenRequest())).rejects.toThrow(
      'OAuth provider request failed',
    );
  });

  it('rejects and cancels oversized provider response streams generically', async () => {
    const cancel = vi.fn();
    const responseBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(64 * 1024 + 1));
      },
      cancel,
    });
    const fetchFunction: OAuthProviderFetch = vi.fn(async () =>
      new Response(responseBody, {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const client = new BoundedOAuthProviderHttpClient({ fetchFunction });

    await expect(client.execute(googleTokenRequest())).rejects.toThrow(
      'OAuth provider request failed',
    );
    expect(cancel).toHaveBeenCalledOnce();
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

    const error = await client
      .execute(request)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    const providerError = error as Error;
    expect(providerError.message).toBe('OAuth provider request failed');
    expect(providerError.cause).toBeUndefined();
    expect(
      JSON.stringify({
        name: providerError.name,
        message: providerError.message,
        cause: providerError.cause,
        stack: providerError.stack,
      }),
    ).not.toContain(providerCredential);
  });

  it('accepts timeout boundaries and rejects unsafe timeout configuration', () => {
    const fetchFunction: OAuthProviderFetch = vi.fn(async () => jsonResponse({}));

    expect(
      () =>
        new BoundedOAuthProviderHttpClient({
          fetchFunction,
          timeoutMs: 100,
        }),
    ).not.toThrow();
    expect(
      () =>
        new BoundedOAuthProviderHttpClient({
          fetchFunction,
          timeoutMs: 10_000,
        }),
    ).not.toThrow();
    for (const timeoutMs of [99, 100.5, 10_001]) {
      expect(
        () =>
          new BoundedOAuthProviderHttpClient({ fetchFunction, timeoutMs }),
      ).toThrow('OAuth provider request failed');
    }
  });
});
