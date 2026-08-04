import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';

/** RFC 9457-compatible problem detail returned by planning HTTP boundaries. */
export interface PlanningProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

/** Headers emitted by the trusted gateway after authenticating a workspace. */
export interface TrustedWorkspaceContextHeaders {
  workspaceId: unknown;
  issuedAt: unknown;
  signature: unknown;
}

const VALIDATION_MESSAGES = new Set([
  'Title is required',
  'Identifier must be an opaque non-numeric string',
  'Planning search request is invalid',
]);
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;

/** Builds a credential-free HTTP exception with a stable machine-readable code. */
function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const problem: PlanningProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

/** Rejects malformed, stale, future-dated, or forged gateway context. */
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

/** Computes the versioned HMAC digest shared by the gateway and planning service. */
function workspaceContextDigest(
  workspaceId: string,
  issuedAt: string,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(`life-os.workspace.v1\n${workspaceId}\n${issuedAt}`, 'utf8')
    .digest();
}

/**
 * Verifies a short-lived HMAC context created only after gateway authentication.
 * Client-selected workspace headers are intentionally not accepted.
 */
export function requireTrustedWorkspaceContext(
  headers: TrustedWorkspaceContextHeaders,
  secret: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES
  ) {
    return unavailableGatewayContext();
  }
  if (
    typeof headers.workspaceId !== 'string' ||
    typeof headers.issuedAt !== 'string' ||
    typeof headers.signature !== 'string' ||
    !UUID_V4_PATTERN.test(headers.workspaceId) ||
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return invalidGatewayContext();
  }

  const workspaceId = headers.workspaceId.toLowerCase();
  const issuedAtSeconds = Number(headers.issuedAt);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS ||
    issuedAtSeconds < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS
  ) {
    return invalidGatewayContext();
  }

  const expected = workspaceContextDigest(
    workspaceId,
    headers.issuedAt,
    secret,
  );
  const actual = Buffer.from(headers.signature, 'base64url');
  if (!timingSafeEqual(actual, expected)) {
    return invalidGatewayContext();
  }
  return workspaceId;
}

/** Requires and trims a non-empty title from an untrusted request body. */
export function requireTitle(body: { title?: unknown } | undefined): string {
  const title = body?.title;
  if (typeof title !== 'string' || !title.trim()) {
    throw problemException(400, 'A title is required', 'invalid_title');
  }
  return title.trim();
}

/** Maps domain and persistence failures to credential-free HTTP exceptions. */
export function toHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }

  if (error instanceof Error && error.message.endsWith('not found')) {
    return problemException(404, 'Planning record not found', 'not_found');
  }

  if (error instanceof Error && VALIDATION_MESSAGES.has(error.message)) {
    return problemException(
      400,
      'Planning request is invalid',
      'invalid_request',
    );
  }

  return problemException(
    503,
    'Planning persistence is unavailable',
    'persistence_unavailable',
  );
}
