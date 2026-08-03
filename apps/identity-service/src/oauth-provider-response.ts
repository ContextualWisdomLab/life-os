import { timingSafeEqual } from 'node:crypto';
import { requireIdentityProvider } from './auth-security';
import type { IdentityProvider } from './identity-domain';

const INVALID_PROVIDER_RESPONSE = 'OAuth provider response is invalid';
const INVALID_GOOGLE_ID_TOKEN = 'Google ID token is invalid';
const INVALID_GITHUB_IDENTITY = 'GitHub identity response is invalid';
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_CLOCK_SKEW_SECONDS = 300;
const GITHUB_API_VERSION = '2026-03-10';

export interface OAuthProviderHttpResponse {
  status: number;
  contentType: string;
  body: string;
}

export interface ParsedOAuthTokens {
  provider: IdentityProvider;
  accessToken: string;
  tokenType: 'bearer';
  scopes: string[];
  expiresInSeconds?: number;
  idToken?: string;
}

export interface ProviderIdentityProfile {
  provider: IdentityProvider;
  providerSubject: string;
  displayName: string;
  verifiedEmail?: string;
}

export interface SignatureVerifiedGoogleToken {
  signatureVerified: true;
  claims: Record<string, unknown>;
}

export interface ProviderApiRequest {
  url: string;
  method: 'GET';
  headers: {
    accept: 'application/vnd.github+json';
    authorization: string;
    'user-agent': 'LifeOS';
    'x-github-api-version': string;
  };
}

function failProviderResponse(): never {
  throw new Error(INVALID_PROVIDER_RESPONSE);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return failProviderResponse();
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

function parseScopes(value: unknown): string[] {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  if (typeof value !== 'string') {
    return failProviderResponse();
  }
  return [...new Set(value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean))];
}

function parsePositiveSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    return failProviderResponse();
  }
  return value;
}

export function parseOAuthTokenResponse(
  providerValue: IdentityProvider,
  response: OAuthProviderHttpResponse,
): ParsedOAuthTokens {
  const provider = requireIdentityProvider(providerValue);
  if (
    !Number.isInteger(response.status) ||
    response.status < 200 ||
    response.status >= 300 ||
    typeof response.body !== 'string' ||
    Buffer.byteLength(response.body, 'utf8') > MAX_PROVIDER_RESPONSE_BYTES ||
    typeof response.contentType !== 'string' ||
    response.contentType.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    return failProviderResponse();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.body);
  } catch {
    return failProviderResponse();
  }
  const payload = asRecord(parsed);
  const accessToken = requireString(payload.access_token, INVALID_PROVIDER_RESPONSE);
  const tokenType = requireString(payload.token_type, INVALID_PROVIDER_RESPONSE).toLowerCase();
  if (tokenType !== 'bearer') {
    return failProviderResponse();
  }

  const tokens: ParsedOAuthTokens = {
    provider,
    accessToken,
    tokenType: 'bearer',
    scopes: parseScopes(payload.scope),
  };

  if (payload.expires_in !== undefined) {
    tokens.expiresInSeconds = parsePositiveSeconds(payload.expires_in);
  }

  if (provider === 'google') {
    tokens.idToken = requireString(payload.id_token, INVALID_PROVIDER_RESPONSE);
    tokens.expiresInSeconds = parsePositiveSeconds(payload.expires_in);
  }

  return tokens;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readStringClaim(claims: Record<string, unknown>, key: string): string | undefined {
  const value = claims[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readAudience(claims: Record<string, unknown>): string[] | undefined {
  const value = claims.aud;
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim())
  ) {
    return value.map((item) => (item as string).trim());
  }
  return undefined;
}

function validEmail(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return /^[^\s@]+@[^\s@]+$/.test(normalized) ? normalized : undefined;
}

export function validateVerifiedGoogleIdentity(
  token: SignatureVerifiedGoogleToken,
  expected: {
    clientId: string;
    nonce: string;
    now?: Date;
    clockSkewSeconds?: number;
  },
): ProviderIdentityProfile {
  const clientId = requireString(expected.clientId, INVALID_GOOGLE_ID_TOKEN);
  const nonce = requireString(expected.nonce, INVALID_GOOGLE_ID_TOKEN);
  const clockSkewSeconds = expected.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS;
  const now = expected.now ?? new Date();
  if (
    !token ||
    typeof token !== 'object' ||
    token.signatureVerified !== true ||
    !token.claims ||
    typeof token.claims !== 'object' ||
    Array.isArray(token.claims) ||
    !Number.isSafeInteger(clockSkewSeconds) ||
    clockSkewSeconds < 0 ||
    clockSkewSeconds > DEFAULT_CLOCK_SKEW_SECONDS ||
    !Number.isFinite(now.getTime())
  ) {
    throw new Error(INVALID_GOOGLE_ID_TOKEN);
  }

  const claims = token.claims;
  const issuer = readStringClaim(claims, 'iss');
  const providerSubject = readStringClaim(claims, 'sub');
  const audiences = readAudience(claims);
  const tokenNonce = readStringClaim(claims, 'nonce');
  const expiration = claims.exp;
  const issuedAt = claims.iat;
  const nowSeconds = Math.floor(now.getTime() / 1000);

  if (
    (issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') ||
    !providerSubject ||
    providerSubject.length > 255 ||
    !/^[\x21-\x7e]+$/.test(providerSubject) ||
    !audiences?.includes(clientId) ||
    typeof expiration !== 'number' ||
    !Number.isSafeInteger(expiration) ||
    expiration <= nowSeconds - clockSkewSeconds ||
    typeof issuedAt !== 'number' ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > nowSeconds + clockSkewSeconds ||
    issuedAt >= expiration ||
    !tokenNonce ||
    !constantTimeEqual(tokenNonce, nonce)
  ) {
    throw new Error(INVALID_GOOGLE_ID_TOKEN);
  }

  if (audiences.length > 1 && readStringClaim(claims, 'azp') !== clientId) {
    throw new Error(INVALID_GOOGLE_ID_TOKEN);
  }

  const verifiedEmail = claims.email_verified === true ? validEmail(claims.email) : undefined;
  const displayName = readStringClaim(claims, 'name') ?? verifiedEmail ?? 'Google user';
  return {
    provider: 'google',
    providerSubject,
    displayName,
    ...(verifiedEmail ? { verifiedEmail } : {}),
  };
}

function requireAccessToken(value: string): string {
  const normalized = requireString(value, 'GitHub access token is required');
  if (/\s/.test(normalized)) {
    throw new Error('GitHub access token is required');
  }
  return normalized;
}

function githubRequest(url: string, accessToken: string): ProviderApiRequest {
  return {
    url,
    method: 'GET',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${accessToken}`,
      'user-agent': 'LifeOS',
      'x-github-api-version': GITHUB_API_VERSION,
    },
  };
}

export function buildGitHubIdentityRequests(accessTokenValue: string): {
  user: ProviderApiRequest;
  emails: ProviderApiRequest;
} {
  const accessToken = requireAccessToken(accessTokenValue);
  return {
    user: githubRequest('https://api.github.com/user', accessToken),
    emails: githubRequest('https://api.github.com/user/emails', accessToken),
  };
}

function normalizeGitHubSubject(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(INVALID_GITHUB_IDENTITY);
    }
    return String(value);
  }
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) {
    return value;
  }
  throw new Error(INVALID_GITHUB_IDENTITY);
}

export function normalizeGitHubIdentity(
  userPayloadValue: unknown,
  emailPayloadValue: unknown,
): ProviderIdentityProfile {
  if (!userPayloadValue || typeof userPayloadValue !== 'object' || Array.isArray(userPayloadValue)) {
    throw new Error(INVALID_GITHUB_IDENTITY);
  }
  if (!Array.isArray(emailPayloadValue)) {
    throw new Error(INVALID_GITHUB_IDENTITY);
  }

  const userPayload = userPayloadValue as Record<string, unknown>;
  const providerSubject = normalizeGitHubSubject(userPayload.id);
  const login = requireString(userPayload.login, INVALID_GITHUB_IDENTITY);
  const name =
    typeof userPayload.name === 'string' && userPayload.name.trim()
      ? userPayload.name.trim()
      : login;

  const verifiedEmails = emailPayloadValue
    .filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
    )
    .filter((entry) => entry.verified === true)
    .map((entry) => ({
      email: validEmail(entry.email),
      primary: entry.primary === true,
    }))
    .filter((entry): entry is { email: string; primary: boolean } => Boolean(entry.email));
  const verifiedEmail =
    verifiedEmails.find((entry) => entry.primary)?.email ?? verifiedEmails[0]?.email;

  return {
    provider: 'github',
    providerSubject,
    displayName: name,
    ...(verifiedEmail ? { verifiedEmail } : {}),
  };
}
