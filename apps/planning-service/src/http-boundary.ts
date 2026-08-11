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

/** Server-owned Planning request identity bound into each gateway context. */
export interface PlanningTrustedRequestBinding {
  method: unknown;
  path: unknown;
}

const VALIDATION_MESSAGES = new Set([
  'Title is required',
  'Identifier must be an opaque non-numeric string',
  'Planning search request is invalid',
]);
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TODAY_PATH_PATTERN = /^\/v1\/today\/\d{4}-\d{2}-\d{2}$/u;
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

/** Accepts only method/path combinations implemented by Planning public routes. */
function requirePlanningRequestBinding(
  binding: PlanningTrustedRequestBinding,
): { method: 'GET' | 'POST' | 'PUT'; path: string } {
  if (
    binding.method !== 'GET' &&
    binding.method !== 'POST' &&
    binding.method !== 'PUT'
  ) {
    return invalidGatewayContext();
  }
  if (
    typeof binding.path !== 'string' ||
    binding.path.length > 256 ||
    /[\u0000-\u001f\u007f?#]/u.test(binding.path)
  ) {
    return invalidGatewayContext();
  }

  const { method, path } = binding as {
    method: 'GET' | 'POST' | 'PUT';
    path: string;
  };
  if (method === 'GET' && path === '/v1/search') {
    return { method, path };
  }
  if ((method === 'GET' || method === 'PUT') && TODAY_PATH_PATTERN.test(path)) {
    return { method, path };
  }
  if ((method === 'GET' || method === 'POST') && path === '/v1/goals') {
    return { method, path };
  }

  const segments = path.split('/');
  if (
    segments.length === 5 &&
    segments[1] === 'v1' &&
    segments[2] === 'goals' &&
    UUID_V4_PATTERN.test(segments[3] ?? '') &&
    segments[4] === 'projects' &&
    (method === 'GET' || method === 'POST')
  ) {
    return { method, path };
  }
  if (
    segments.length === 5 &&
    segments[1] === 'v1' &&
    segments[2] === 'projects' &&
    UUID_V4_PATTERN.test(segments[3] ?? '') &&
    segments[4] === 'tasks' &&
    (method === 'GET' || method === 'POST')
  ) {
    return { method, path };
  }
  return invalidGatewayContext();
}

/** Computes the request-bound HMAC digest shared by Planning and trusted hosts. */
function workspaceContextDigest(
  workspaceId: string,
  issuedAt: string,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(
      `life-os.planning-context.v2\n${workspaceId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest();
}

/**
 * Verifies a short-lived request-bound HMAC context created after gateway
 * authentication. Client-selected workspace headers are never authority, and
 * a context for one Planning method/resource cannot be replayed onto another.
 */
export function requireTrustedWorkspaceContext(
  headers: TrustedWorkspaceContextHeaders,
  secret: unknown,
  requestBinding: PlanningTrustedRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES
  ) {
    return unavailableGatewayContext();
  }
  const { method, path } = requirePlanningRequestBinding(requestBinding);
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
    method,
    path,
    secret,
  );
  const actual = Buffer.from(headers.signature, 'base64url');
  if (
    actual.length !== expected.length ||
    actual.toString('base64url') !== headers.signature ||
    !timingSafeEqual(actual, expected)
  ) {
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
