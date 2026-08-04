import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';

/** Headers emitted by a private gateway after session authentication and authorization. */
export interface TrustedAiContextHeaders {
  workspaceId: unknown;
  actorId: unknown;
  issuedAt: unknown;
  signature: unknown;
}

/** Canonical tenant and actor scope proven by the signed service context. */
export interface TrustedAiContext {
  readonly workspaceId: string;
  readonly actorId: string;
}

/** Credential-free RFC 9457-compatible problem returned by the AI HTTP boundary. */
interface AiProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CANONICAL_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const PROPOSAL_PATH_PATTERN =
  /^\/v1\/proposals(?:\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(\/decisions)?)?$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_GATEWAY_SECRET_BYTES = 4096;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
const MAXIMUM_PATH_CHARACTERS = 256;

/** Creates one stable problem exception without retaining credentials or untrusted values. */
function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const details: AiProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(details, status);
}

/** Rejects malformed, stale, replayed, or forged service context. */
function invalidGatewayContext(): never {
  throw problemException(
    401,
    'Trusted gateway context is invalid',
    'invalid_gateway_context',
  );
}

/** Rejects requests when the service cannot verify gateway authenticity. */
function unavailableGatewayContext(): never {
  throw problemException(
    503,
    'Trusted gateway context is unavailable',
    'gateway_context_unavailable',
  );
}

/** Requires a bounded secret appropriate for the shared HMAC trust boundary. */
function requireGatewaySecret(value: unknown): string {
  if (typeof value !== 'string') {
    return unavailableGatewayContext();
  }
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (
    byteLength < MINIMUM_GATEWAY_SECRET_BYTES ||
    byteLength > MAXIMUM_GATEWAY_SECRET_BYTES ||
    /[\r\n\u0000]/u.test(value)
  ) {
    return unavailableGatewayContext();
  }
  return value;
}

/** Requires one exact supported uppercase method and canonical proposal path. */
function requireMethodAndPath(
  method: unknown,
  path: unknown,
): { method: 'GET' | 'POST'; path: string } {
  if (
    (method !== 'GET' && method !== 'POST') ||
    typeof path !== 'string' ||
    path.length > MAXIMUM_PATH_CHARACTERS ||
    /[\u0000-\u001f\u007f]/u.test(path)
  ) {
    return invalidGatewayContext();
  }
  const match = PROPOSAL_PATH_PATTERN.exec(path);
  if (!match) {
    return invalidGatewayContext();
  }
  const proposalId = match[1];
  const decisionsSuffix = match[2];
  if (proposalId && !CANONICAL_UUID_V4_PATTERN.test(proposalId)) {
    return invalidGatewayContext();
  }
  if (proposalId && !decisionsSuffix && method !== 'GET') {
    return invalidGatewayContext();
  }
  return { method, path };
}

/** Computes the exact versioned HMAC shared by the BFF and AI service. */
function contextDigest(
  workspaceId: string,
  actorId: string,
  issuedAt: string,
  method: 'GET' | 'POST',
  path: string,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(
      `life-os.ai-context.v1\n${workspaceId}\n${actorId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest();
}

/**
 * Verifies a fresh method-and-path-bound service context created only after
 * gateway session authentication and workspace authorization.
 */
export function requireTrustedAiContext(
  headers: TrustedAiContextHeaders,
  secretValue: unknown,
  methodValue: unknown,
  pathValue: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): TrustedAiContext {
  const secret = requireGatewaySecret(secretValue);
  const { method, path } = requireMethodAndPath(methodValue, pathValue);
  if (
    typeof headers.workspaceId !== 'string' ||
    typeof headers.actorId !== 'string' ||
    typeof headers.issuedAt !== 'string' ||
    typeof headers.signature !== 'string' ||
    !UUID_V4_PATTERN.test(headers.workspaceId) ||
    !UUID_V4_PATTERN.test(headers.actorId) ||
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return invalidGatewayContext();
  }

  const workspaceId = headers.workspaceId.toLowerCase();
  const actorId = headers.actorId.toLowerCase();
  const issuedAtSeconds = Number(headers.issuedAt);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS ||
    issuedAtSeconds < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS
  ) {
    return invalidGatewayContext();
  }

  const actual = Buffer.from(headers.signature, 'base64url');
  if (
    actual.length !== 32 ||
    actual.toString('base64url') !== headers.signature
  ) {
    return invalidGatewayContext();
  }
  const expected = contextDigest(
    workspaceId,
    actorId,
    headers.issuedAt,
    method,
    path,
    secret,
  );
  if (!timingSafeEqual(actual, expected)) {
    return invalidGatewayContext();
  }

  return Object.freeze({ workspaceId, actorId });
}
