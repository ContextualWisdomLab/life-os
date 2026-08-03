import {
  createPublicKey,
  timingSafeEqual,
  verify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { requireSafeRedirectUri } from './oauth-redirect-uri';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_JWKS_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = new Set([
  'https://accounts.google.com',
  'accounts.google.com',
]);
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const BASE64URL_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const SUBJECT_PATTERN = /^[\x21-\x7e]{1,255}$/;
const MAXIMUM_HTTP_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_JWT_SEGMENT_BYTES = 32 * 1024;
const MAXIMUM_JWKS_KEYS = 64;
const DEFAULT_REQUEST_TIMEOUT_MS = 5_000;
const DEFAULT_CLOCK_SKEW_SECONDS = 60;
const DEFAULT_JWKS_CACHE_SECONDS = 300;
const MAXIMUM_JWKS_CACHE_SECONDS = 24 * 60 * 60;

interface FixedEndpointHeaders {
  get(name: string): string | null;
}

interface FixedEndpointResponse {
  readonly status: number;
  readonly headers: FixedEndpointHeaders;
  text(): Promise<string>;
}

export interface FixedEndpointFetchInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  redirect: 'error';
  signal: AbortSignal;
}

export type FixedEndpointFetch = (
  url: string,
  init: FixedEndpointFetchInit,
) => Promise<FixedEndpointResponse>;

export interface GoogleOidcClientOptions {
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  fetch?: FixedEndpointFetch;
  now?: () => Date;
  requestTimeoutMs?: number;
  clockSkewSeconds?: number;
}

export interface GoogleAuthorizationCodeInput {
  code: string;
  codeVerifier: string;
  nonce: string;
}

export interface VerifiedGoogleIdentity {
  provider: 'google';
  subject: string;
  issuer: 'https://accounts.google.com' | 'accounts.google.com';
  email?: string;
  emailVerified?: boolean;
  displayName?: string;
  hostedDomain?: string;
}

interface ParsedJwt {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signature: Buffer;
  signedContent: Buffer;
}

interface CachedGoogleKeySet {
  expiresAtMs: number;
  keys: ReadonlyMap<string, KeyObject>;
}

function fail(message: string): never {
  throw new Error(message);
}

function requireBoundedText(
  value: unknown,
  message: string,
  maximumLength: number,
): string {
  if (typeof value !== 'string') {
    return fail(message);
  }
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximumLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return fail(message);
  }
  return normalized;
}

function requireBoundedInteger(
  value: number | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  message: string,
): number {
  const resolved = value ?? defaultValue;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < minimum ||
    resolved > maximum
  ) {
    return fail(message);
  }
  return resolved;
}

function parseJsonObject(
  text: string,
  message: string,
): Record<string, unknown> {
  if (!text || Buffer.byteLength(text, 'utf8') > MAXIMUM_HTTP_RESPONSE_BYTES) {
    return fail(message);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail(message);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(message);
  }
  return parsed as Record<string, unknown>;
}

function decodeBase64UrlSegment(segment: string, message: string): Buffer {
  if (
    !BASE64URL_SEGMENT_PATTERN.test(segment) ||
    Buffer.byteLength(segment, 'ascii') > MAXIMUM_JWT_SEGMENT_BYTES
  ) {
    return fail(message);
  }
  const decoded = Buffer.from(segment, 'base64url');
  if (decoded.length === 0 || decoded.toString('base64url') !== segment) {
    return fail(message);
  }
  return decoded;
}

function parseJwt(idTokenValue: unknown): ParsedJwt {
  const idToken = requireBoundedText(
    idTokenValue,
    'Google ID token is invalid',
    MAXIMUM_JWT_SEGMENT_BYTES * 3,
  );
  const segments = idToken.split('.');
  if (segments.length !== 3) {
    return fail('Google ID token is invalid');
  }
  const [encodedHeader, encodedClaims, encodedSignature] = segments;
  const header = parseJsonObject(
    decodeBase64UrlSegment(
      encodedHeader,
      'Google ID token is invalid',
    ).toString('utf8'),
    'Google ID token is invalid',
  );
  const claims = parseJsonObject(
    decodeBase64UrlSegment(
      encodedClaims,
      'Google ID token is invalid',
    ).toString('utf8'),
    'Google ID token is invalid',
  );
  return {
    header,
    claims,
    signature: decodeBase64UrlSegment(
      encodedSignature,
      'Google ID token is invalid',
    ),
    signedContent: Buffer.from(`${encodedHeader}.${encodedClaims}`, 'ascii'),
  };
}

function requireNumericDate(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    return fail(message);
  }
  return value;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function optionalClaimText(
  value: unknown,
  maximumLength: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireBoundedText(
    value,
    'Google ID token claims are invalid',
    maximumLength,
  );
}

function parseCacheSeconds(cacheControl: string | null): number {
  const match = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)(?:\s*,|$)/i);
  if (!match) {
    return DEFAULT_JWKS_CACHE_SECONDS;
  }
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds) || seconds < 0) {
    return DEFAULT_JWKS_CACHE_SECONDS;
  }
  return Math.min(seconds, MAXIMUM_JWKS_CACHE_SECONDS);
}

function requireResponseLength(response: FixedEndpointResponse): void {
  const contentLength = response.headers.get('content-length');
  if (contentLength === null) {
    return;
  }
  const bytes = Number(contentLength);
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > MAXIMUM_HTTP_RESPONSE_BYTES
  ) {
    return fail('Google identity provider response is invalid');
  }
}

function requireGoogleJwk(value: unknown): { kid: string; key: KeyObject } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('Google signing key set is invalid');
  }
  const jwk = value as Record<string, unknown>;
  const kid = requireBoundedText(
    jwk.kid,
    'Google signing key set is invalid',
    128,
  );
  if (
    jwk.kty !== 'RSA' ||
    (jwk.alg !== undefined && jwk.alg !== 'RS256') ||
    (jwk.use !== undefined && jwk.use !== 'sig') ||
    typeof jwk.n !== 'string' ||
    typeof jwk.e !== 'string'
  ) {
    return fail('Google signing key set is invalid');
  }
  if (
    jwk.key_ops !== undefined &&
    (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify'))
  ) {
    return fail('Google signing key set is invalid');
  }
  let key: KeyObject;
  try {
    key = createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' });
  } catch {
    return fail('Google signing key set is invalid');
  }
  if (key.asymmetricKeyType !== 'rsa') {
    return fail('Google signing key set is invalid');
  }
  return { kid, key };
}

export class GoogleOidcClient {
  private readonly clientId: string;
  private readonly clientSecret: string | undefined;
  private readonly redirectUri: string;
  private readonly fetcher: FixedEndpointFetch;
  private readonly now: () => Date;
  private readonly requestTimeoutMs: number;
  private readonly clockSkewSeconds: number;
  private keySet: CachedGoogleKeySet | undefined;

  constructor(options: GoogleOidcClientOptions) {
    this.clientId = requireBoundedText(
      options.clientId,
      'Google OAuth client ID is invalid',
      512,
    );
    this.clientSecret = options.clientSecret
      ? requireBoundedText(
          options.clientSecret,
          'Google OAuth client secret is invalid',
          2_048,
        )
      : undefined;
    this.redirectUri = requireSafeRedirectUri(options.redirectUri);
    this.fetcher =
      options.fetch ??
      ((url, init) => fetch(url, init) as Promise<FixedEndpointResponse>);
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMs = requireBoundedInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      100,
      30_000,
      'Google request timeout is invalid',
    );
    this.clockSkewSeconds = requireBoundedInteger(
      options.clockSkewSeconds,
      DEFAULT_CLOCK_SKEW_SECONDS,
      0,
      300,
      'Google token clock skew is invalid',
    );
  }

  async authenticateAuthorizationCode(
    input: GoogleAuthorizationCodeInput,
  ): Promise<VerifiedGoogleIdentity> {
    const code = requireBoundedText(
      input.code,
      'Google authorization code is invalid',
      4_096,
    );
    if (!PKCE_VERIFIER_PATTERN.test(input.codeVerifier)) {
      return fail('Google PKCE verifier is invalid');
    }
    const nonce = requireBoundedText(
      input.nonce,
      'Google nonce is invalid',
      512,
    );
    const tokenResponse = await this.postTokenRequest(code, input.codeVerifier);
    const idToken = requireBoundedText(
      tokenResponse.id_token,
      'Google token response is invalid',
      MAXIMUM_JWT_SEGMENT_BYTES * 3,
    );
    return await this.verifyIdToken(idToken, nonce);
  }

  private async postTokenRequest(
    code: string,
    codeVerifier: string,
  ): Promise<Record<string, unknown>> {
    const form = new URLSearchParams({
      client_id: this.clientId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri,
    });
    if (this.clientSecret) {
      form.set('client_secret', this.clientSecret);
    }
    return await this.requestJson(
      GOOGLE_TOKEN_ENDPOINT,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
        redirect: 'error',
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      },
      'Google token exchange failed',
    );
  }

  private async verifyIdToken(
    idToken: string,
    expectedNonce: string,
  ): Promise<VerifiedGoogleIdentity> {
    const parsed = parseJwt(idToken);
    if (
      parsed.header.alg !== 'RS256' ||
      (parsed.header.typ !== undefined && parsed.header.typ !== 'JWT')
    ) {
      return fail('Google ID token is invalid');
    }
    const kid = requireBoundedText(
      parsed.header.kid,
      'Google ID token is invalid',
      128,
    );
    const key = await this.signingKey(kid);
    if (!verify('RSA-SHA256', parsed.signedContent, key, parsed.signature)) {
      return fail('Google ID token is invalid');
    }
    return this.verifyClaims(parsed.claims, expectedNonce);
  }

  private verifyClaims(
    claims: Record<string, unknown>,
    expectedNonce: string,
  ): VerifiedGoogleIdentity {
    const issuer = requireBoundedText(
      claims.iss,
      'Google ID token claims are invalid',
      64,
    );
    if (!GOOGLE_ISSUERS.has(issuer)) {
      return fail('Google ID token claims are invalid');
    }
    if (claims.aud !== this.clientId) {
      return fail('Google ID token claims are invalid');
    }
    if (claims.azp !== undefined && claims.azp !== this.clientId) {
      return fail('Google ID token claims are invalid');
    }
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    const expiresAt = requireNumericDate(
      claims.exp,
      'Google ID token claims are invalid',
    );
    const issuedAt = requireNumericDate(
      claims.iat,
      'Google ID token claims are invalid',
    );
    if (
      expiresAt <= nowSeconds - this.clockSkewSeconds ||
      issuedAt > nowSeconds + this.clockSkewSeconds
    ) {
      return fail('Google ID token claims are invalid');
    }
    if (
      claims.nbf !== undefined &&
      requireNumericDate(claims.nbf, 'Google ID token claims are invalid') >
        nowSeconds + this.clockSkewSeconds
    ) {
      return fail('Google ID token claims are invalid');
    }
    const nonce = requireBoundedText(
      claims.nonce,
      'Google ID token claims are invalid',
      512,
    );
    if (!constantTimeEqual(nonce, expectedNonce)) {
      return fail('Google ID token claims are invalid');
    }
    const subject = requireBoundedText(
      claims.sub,
      'Google ID token claims are invalid',
      255,
    );
    if (!SUBJECT_PATTERN.test(subject)) {
      return fail('Google ID token claims are invalid');
    }
    const email = optionalClaimText(claims.email, 320);
    const displayName = optionalClaimText(claims.name, 256);
    const hostedDomain = optionalClaimText(claims.hd, 253);
    if (
      claims.email_verified !== undefined &&
      typeof claims.email_verified !== 'boolean'
    ) {
      return fail('Google ID token claims are invalid');
    }
    return Object.freeze({
      provider: 'google' as const,
      subject,
      issuer: issuer as VerifiedGoogleIdentity['issuer'],
      ...(email ? { email } : {}),
      ...(claims.email_verified !== undefined
        ? { emailVerified: claims.email_verified as boolean }
        : {}),
      ...(displayName ? { displayName } : {}),
      ...(hostedDomain ? { hostedDomain } : {}),
    });
  }

  private async signingKey(kid: string): Promise<KeyObject> {
    const nowMs = this.now().getTime();
    if (!this.keySet || this.keySet.expiresAtMs <= nowMs) {
      this.keySet = await this.fetchKeySet();
    }
    let key = this.keySet.keys.get(kid);
    if (!key) {
      this.keySet = await this.fetchKeySet();
      key = this.keySet.keys.get(kid);
    }
    if (!key) {
      return fail('Google ID token is invalid');
    }
    return key;
  }

  private async fetchKeySet(): Promise<CachedGoogleKeySet> {
    const response = await this.fetchResponse(GOOGLE_JWKS_ENDPOINT, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    if (response.status !== 200) {
      return fail('Google signing key retrieval failed');
    }
    requireResponseLength(response);
    const body = parseJsonObject(
      await response.text(),
      'Google signing key set is invalid',
    );
    if (
      !Array.isArray(body.keys) ||
      body.keys.length === 0 ||
      body.keys.length > MAXIMUM_JWKS_KEYS
    ) {
      return fail('Google signing key set is invalid');
    }
    const keys = new Map<string, KeyObject>();
    for (const value of body.keys) {
      const parsed = requireGoogleJwk(value);
      if (keys.has(parsed.kid)) {
        return fail('Google signing key set is invalid');
      }
      keys.set(parsed.kid, parsed.key);
    }
    return {
      expiresAtMs:
        this.now().getTime() +
        parseCacheSeconds(response.headers.get('cache-control')) * 1_000,
      keys,
    };
  }

  private async requestJson(
    url: string,
    init: FixedEndpointFetchInit,
    failureMessage: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchResponse(url, init);
    if (response.status < 200 || response.status >= 300) {
      return fail(failureMessage);
    }
    requireResponseLength(response);
    return parseJsonObject(await response.text(), failureMessage);
  }

  private async fetchResponse(
    url: string,
    init: FixedEndpointFetchInit,
  ): Promise<FixedEndpointResponse> {
    try {
      return await this.fetcher(url, init);
    } catch {
      return fail('Google identity provider request failed');
    }
  }
}
