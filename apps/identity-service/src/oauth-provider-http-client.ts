const PROVIDER_REQUEST_FAILED = 'OAuth provider request failed';
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const MINIMUM_REQUEST_TIMEOUT_MS = 100;
const MAXIMUM_REQUEST_TIMEOUT_MS = 10_000;
const MAXIMUM_REQUEST_BODY_BYTES = 16 * 1024;
const MAXIMUM_RESPONSE_BODY_BYTES = 64 * 1024;
const MAXIMUM_HEADER_VALUE_LENGTH = 8 * 1024;
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const SAFE_HEADER_VALUE_PATTERN = /^[^\u0000\r\n]*$/;

interface EndpointPolicy {
  method: 'GET' | 'POST';
  url: string;
  requiredHeaders: Readonly<Record<string, string | RegExp>>;
  body: 'forbidden' | 'required';
}

const ENDPOINT_POLICIES: readonly EndpointPolicy[] = Object.freeze([
  {
    method: 'POST',
    url: 'https://oauth2.googleapis.com/token',
    requiredHeaders: Object.freeze({
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    }),
    body: 'required',
  },
  {
    method: 'POST',
    url: 'https://github.com/login/oauth/access_token',
    requiredHeaders: Object.freeze({
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    }),
    body: 'required',
  },
  {
    method: 'GET',
    url: 'https://api.github.com/user',
    requiredHeaders: Object.freeze({
      accept: 'application/vnd.github+json',
      authorization: /^Bearer [^\s]+$/,
      'user-agent': 'LifeOS',
      'x-github-api-version': /^\d{4}-\d{2}-\d{2}$/,
    }),
    body: 'forbidden',
  },
  {
    method: 'GET',
    url: 'https://api.github.com/user/emails',
    requiredHeaders: Object.freeze({
      accept: 'application/vnd.github+json',
      authorization: /^Bearer [^\s]+$/,
      'user-agent': 'LifeOS',
      'x-github-api-version': /^\d{4}-\d{2}-\d{2}$/,
    }),
    body: 'forbidden',
  },
  {
    method: 'GET',
    url: 'https://www.googleapis.com/oauth2/v3/certs',
    requiredHeaders: Object.freeze({ accept: 'application/json' }),
    body: 'forbidden',
  },
]);

/**
 * A provider request created by a fixed-endpoint OAuth request builder.
 */
export interface OAuthProviderHttpRequest<Headers extends object = object> {
  url: string;
  method: 'GET' | 'POST';
  headers: Headers;
  body?: string;
}

/**
 * The bounded response shape consumed by provider-specific parsers.
 */
export interface OAuthProviderHttpResult {
  status: number;
  contentType: string;
  body: string;
}

/**
 * Injectable fetch-compatible function used by the provider HTTP boundary.
 */
export type OAuthProviderFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

/**
 * Configuration for the bounded provider HTTP boundary.
 */
export interface OAuthProviderHttpClientOptions {
  fetchFunction?: OAuthProviderFetch;
  timeoutMs?: number;
}

function failProviderRequest(): never {
  throw new Error(PROVIDER_REQUEST_FAILED);
}

function requireTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < MINIMUM_REQUEST_TIMEOUT_MS ||
    timeoutMs > MAXIMUM_REQUEST_TIMEOUT_MS
  ) {
    return failProviderRequest();
  }
  return timeoutMs;
}

function requirePolicy(request: OAuthProviderHttpRequest): EndpointPolicy {
  if (
    !request ||
    typeof request !== 'object' ||
    (request.method !== 'GET' && request.method !== 'POST') ||
    typeof request.url !== 'string'
  ) {
    return failProviderRequest();
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(request.url);
  } catch {
    return failProviderRequest();
  }
  if (
    parsedUrl.protocol !== 'https:' ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.hash ||
    parsedUrl.href !== request.url
  ) {
    return failProviderRequest();
  }

  const policy = ENDPOINT_POLICIES.find(
    (candidate) =>
      candidate.method === request.method && candidate.url === request.url,
  );
  return policy ?? failProviderRequest();
}

function normalizeHeaders(headersValue: object): Record<string, string> {
  if (
    !headersValue ||
    typeof headersValue !== 'object' ||
    Array.isArray(headersValue)
  ) {
    return failProviderRequest();
  }

  const headers = Object.create(null) as Record<string, string>;
  for (const [providedName, providedValue] of Object.entries(headersValue)) {
    const name = providedName.toLowerCase();
    if (
      !HEADER_NAME_PATTERN.test(providedName) ||
      typeof providedValue !== 'string' ||
      providedValue.length > MAXIMUM_HEADER_VALUE_LENGTH ||
      !SAFE_HEADER_VALUE_PATTERN.test(providedValue) ||
      Object.hasOwn(headers, name)
    ) {
      return failProviderRequest();
    }
    headers[name] = providedValue;
  }
  return headers;
}

function requireHeaders(
  headersValue: object,
  policy: EndpointPolicy,
): Record<string, string> {
  const headers = normalizeHeaders(headersValue);
  const expectedNames = Object.keys(policy.requiredHeaders);
  if (
    Object.keys(headers).length !== expectedNames.length ||
    !expectedNames.every((name) => Object.hasOwn(headers, name))
  ) {
    return failProviderRequest();
  }

  for (const [name, expected] of Object.entries(policy.requiredHeaders)) {
    const value = headers[name];
    if (
      value === undefined ||
      (typeof expected === 'string'
        ? value !== expected
        : !expected.test(value))
    ) {
      return failProviderRequest();
    }
  }
  return headers;
}

function requireBody(
  body: string | undefined,
  policy: EndpointPolicy,
): string | undefined {
  if (policy.body === 'forbidden') {
    if (body !== undefined) {
      return failProviderRequest();
    }
    return undefined;
  }

  if (
    typeof body !== 'string' ||
    body.length === 0 ||
    Buffer.byteLength(body, 'utf8') > MAXIMUM_REQUEST_BODY_BYTES
  ) {
    return failProviderRequest();
  }
  return body;
}

function requireJsonContentType(response: Response): string {
  const contentType = response.headers.get('content-type');
  if (
    !contentType ||
    contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    return failProviderRequest();
  }
  return contentType;
}

function requireBoundedContentLength(response: Response): void {
  const contentLength = response.headers.get('content-length');
  if (contentLength === null) {
    return;
  }
  if (!/^\d+$/.test(contentLength)) {
    return failProviderRequest();
  }
  const parsedLength = Number(contentLength);
  if (
    !Number.isSafeInteger(parsedLength) ||
    parsedLength > MAXIMUM_RESPONSE_BODY_BYTES
  ) {
    return failProviderRequest();
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  requireBoundedContentLength(response);
  if (!response.body) {
    return '';
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytesRead = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      bytesRead += chunk.value.byteLength;
      if (bytesRead > MAXIMUM_RESPONSE_BODY_BYTES) {
        return failProviderRequest();
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch {
    try {
      await reader.cancel();
    } catch {
      // The standardized provider failure remains authoritative.
    }
    return failProviderRequest();
  } finally {
    reader.releaseLock();
  }
}

/**
 * Executes only allowlisted OAuth provider requests with no redirects, bounded
 * latency, bounded UTF-8 JSON responses, and credential-safe generic failures.
 */
export class BoundedOAuthProviderHttpClient {
  private readonly fetchFunction: OAuthProviderFetch;
  private readonly timeoutMs: number;

  constructor(options: OAuthProviderHttpClientOptions = {}) {
    const defaultFetch =
      typeof globalThis.fetch === 'function'
        ? (globalThis.fetch.bind(globalThis) as OAuthProviderFetch)
        : undefined;
    this.fetchFunction =
      options.fetchFunction ?? defaultFetch ?? failProviderRequest();
    this.timeoutMs = requireTimeout(options.timeoutMs);
  }

  /**
   * Executes one exact provider request and returns its bounded JSON response.
   */
  async execute(
    request: OAuthProviderHttpRequest,
  ): Promise<OAuthProviderHttpResult> {
    const policy = requirePolicy(request);
    const headers = requireHeaders(request.headers, policy);
    const body = requireBody(request.body, policy);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFunction(policy.url, {
        method: policy.method,
        headers,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: abortController.signal,
        ...(body === undefined ? {} : { body }),
      });
      if (
        !response ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599 ||
        (response.status >= 300 && response.status < 400)
      ) {
        return failProviderRequest();
      }

      const contentType = requireJsonContentType(response);
      const responseBody = await readBoundedBody(response);
      return {
        status: response.status,
        contentType,
        body: responseBody,
      };
    } catch {
      abortController.abort();
      return failProviderRequest();
    } finally {
      clearTimeout(timeout);
    }
  }
}
