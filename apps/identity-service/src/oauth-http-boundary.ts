import { randomBytes } from 'node:crypto';
import type { ActiveSession } from './auth-security';

const COOKIE_HEADER_LIMIT_BYTES = 4 * 1024;
const QUERY_VALUE_LIMIT_BYTES = 2 * 1024;
const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const OPAQUE_COOKIE_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/;
const CALLBACK_QUERY_KEYS = new Set([
  'code',
  'state',
  'error',
  'error_description',
  'error_uri',
]);

export const OAUTH_BROWSER_COOKIE_NAME = 'life_os_oauth_browser';
export const APPLICATION_SESSION_COOKIE_NAME = 'life_os_session';

export interface ProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

export type OAuthCallbackQuery =
  | {
      outcome: 'authorization_code';
      code: string;
      state: string;
    }
  | {
      outcome: 'provider_error';
      error: string;
      state: string;
      errorDescription?: string;
      errorUri?: string;
    };

function failInvalidCookie(): never {
  throw new Error('Cookie header is invalid');
}

function requireBoundedText(value: unknown, fieldName: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    Buffer.byteLength(value, 'utf8') > QUERY_VALUE_LIMIT_BYTES ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${fieldName} is invalid`);
  }
  return value.trim();
}

function optionalSingleQueryValue(
  query: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    throw new Error(`OAuth callback parameter ${key} must appear once`);
  }
  return requireBoundedText(value, `OAuth callback parameter ${key}`);
}

function requireCookieName(value: string): string {
  if (!COOKIE_NAME_PATTERN.test(value)) {
    throw new Error('Cookie name is invalid');
  }
  return value;
}

function requireOpaqueCookieValue(value: string): string {
  if (!OPAQUE_COOKIE_VALUE_PATTERN.test(value)) {
    throw new Error('Cookie value is invalid');
  }
  return value;
}

function requirePositiveInteger(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(message);
  }
  return value;
}

/**
 * Parses a bounded Cookie header without decoding or accepting duplicate names.
 */
export function parseCookieHeader(
  header: string | undefined,
): Readonly<Record<string, string>> {
  if (header === undefined || header === '') {
    return Object.freeze({});
  }
  if (
    typeof header !== 'string' ||
    Buffer.byteLength(header, 'utf8') > COOKIE_HEADER_LIMIT_BYTES ||
    /[\r\n\u0000]/.test(header)
  ) {
    return failInvalidCookie();
  }

  const cookies: Record<string, string> = {};
  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    if (separator <= 0) {
      return failInvalidCookie();
    }
    const name = requireCookieName(segment.slice(0, separator).trim());
    const value = segment.slice(separator + 1).trim();
    if (
      !value ||
      !OPAQUE_COOKIE_VALUE_PATTERN.test(value) ||
      cookies[name] !== undefined
    ) {
      return failInvalidCookie();
    }
    cookies[name] = value;
  }
  return Object.freeze({ ...cookies });
}

/**
 * Returns one opaque cookie value, or undefined when the cookie is absent.
 */
export function readOpaqueCookie(
  header: string | undefined,
  nameValue: string,
): string | undefined {
  const name = requireCookieName(nameValue);
  return parseCookieHeader(header)[name];
}

/**
 * Parses the deliberately small OAuth callback query surface and rejects repeats or unknown keys.
 */
export function parseOAuthCallbackQuery(
  query: Readonly<Record<string, unknown>>,
): OAuthCallbackQuery {
  for (const key of Object.keys(query)) {
    if (!CALLBACK_QUERY_KEYS.has(key)) {
      throw new Error('OAuth callback contains an unsupported parameter');
    }
  }

  const code = optionalSingleQueryValue(query, 'code');
  const state = optionalSingleQueryValue(query, 'state');
  const error = optionalSingleQueryValue(query, 'error');
  const errorDescription = optionalSingleQueryValue(query, 'error_description');
  const errorUri = optionalSingleQueryValue(query, 'error_uri');

  if (!state || Boolean(code) === Boolean(error)) {
    throw new Error('OAuth callback is invalid');
  }
  if (code) {
    if (errorDescription || errorUri) {
      throw new Error('OAuth callback is invalid');
    }
    return { outcome: 'authorization_code', code, state };
  }
  return {
    outcome: 'provider_error',
    error: error as string,
    state,
    ...(errorDescription ? { errorDescription } : {}),
    ...(errorUri ? { errorUri } : {}),
  };
}

/**
 * Serializes an opaque cookie with the security attributes required by the browser boundary.
 */
export function serializeSecureCookie(input: {
  name: string;
  value: string;
  maxAgeSeconds: number;
  path?: string;
}): string {
  const name = requireCookieName(input.name);
  const value = requireOpaqueCookieValue(input.value);
  const maxAgeSeconds = requirePositiveInteger(
    input.maxAgeSeconds,
    'Cookie max age must be a positive integer',
  );
  const path = input.path ?? '/';
  if (!path.startsWith('/') || /[;\r\n]/.test(path)) {
    throw new Error('Cookie path is invalid');
  }
  return `${name}=${value}; Path=${path}; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Creates a new opaque browser binding and its short-lived authorization cookie.
 */
export function createOAuthBrowserBinding(maxAgeSeconds = 10 * 60): {
  browserSessionId: string;
  setCookie: string;
} {
  const browserSessionId = randomBytes(32).toString('base64url');
  return {
    browserSessionId,
    setCookie: serializeSecureCookie({
      name: OAUTH_BROWSER_COOKIE_NAME,
      value: browserSessionId,
      maxAgeSeconds,
      path: '/v1/auth',
    }),
  };
}

/**
 * Creates the secure, server-backed application session cookie.
 */
export function serializeApplicationSessionCookie(
  token: string,
  expiresAt: string,
  now = new Date(),
): string {
  const expiration = Date.parse(expiresAt);
  if (
    !Number.isFinite(expiration) ||
    !Number.isFinite(now.getTime()) ||
    expiration <= now.getTime()
  ) {
    throw new Error('Session expiration is invalid');
  }
  const maxAgeSeconds = Math.max(
    1,
    Math.floor((expiration - now.getTime()) / 1000),
  );
  return serializeSecureCookie({
    name: APPLICATION_SESSION_COOKIE_NAME,
    value: token,
    maxAgeSeconds,
    path: '/',
  });
}

/**
 * Clears the browser session cookie without exposing its prior value.
 */
export function clearApplicationSessionCookie(): string {
  return `${APPLICATION_SESSION_COOKIE_NAME}=deleted; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

/**
 * Accepts only an HTTPS origin and derives the fixed post-login target.
 */
export function buildFixedWebRedirect(configuredOrigin: string): string {
  const parsed = new URL(configuredOrigin);
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Configured web origin is invalid');
  }
  return new URL('/auth/complete', parsed.origin).toString();
}

/**
 * Produces a credential-free session representation for browser introspection.
 */
export function toSessionView(session: ActiveSession): {
  sessionId: string;
  userId: string;
  workspaceId: string;
  createdAt: string;
  expiresAt: string;
} {
  return {
    sessionId: session.id,
    userId: session.userId,
    workspaceId: session.workspaceId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
}

/**
 * Produces a stable RFC 9457-compatible problem body without internal details.
 */
export function problemDetails(
  status: number,
  title: string,
  code: string,
): ProblemDetails {
  if (!Number.isSafeInteger(status) || status < 400 || status > 599) {
    throw new Error('Problem status is invalid');
  }
  return {
    type: 'about:blank',
    title: requireBoundedText(title, 'Problem title'),
    status,
    code: requireBoundedText(code, 'Problem code'),
  };
}
