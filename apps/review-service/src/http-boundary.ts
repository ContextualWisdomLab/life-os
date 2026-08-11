import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import {
  ReviewCompletionConflictError,
  ReviewValidationError,
  requireReviewLimit,
  requireReviewRitualKind,
  requireReviewWorkspaceId,
  type ReviewRitualKind,
} from './review-domain';
import { ReviewPersistenceError } from './postgres-review-repository';

/** Bounded problem-details response returned by the Review HTTP boundary. */
export interface ReviewProblemDetails {
  type: 'about:blank';
  title: string;
  status: number;
  code: string;
}

/** Signed tenant authority emitted by the authenticated gateway boundary. */
export interface ReviewTrustedWorkspaceContextHeaders {
  workspaceId: unknown;
  issuedAt: unknown;
  signature: unknown;
}

/** Server-owned request identity bound into each Review gateway context. */
export interface ReviewTrustedRequestBinding {
  method: unknown;
  path: unknown;
}

const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
const REVIEW_HISTORY_PATH = '/v1/reviews/completions';
const REVIEW_COMPLETION_PATHS = new Set([
  '/v1/reviews/daily-planning/completions',
  '/v1/reviews/daily-shutdown/completions',
  '/v1/reviews/weekly-review/completions',
]);

function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const problem: ReviewProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

/** Rejects malformed, forged, stale, or future trusted context with a credential-free 401 problem. */
function invalidGatewayContext(): never {
  throw problemException(
    401,
    'Trusted gateway context is invalid',
    'invalid_gateway_context',
  );
}

/** Reports verifier configuration that cannot authenticate context as a bounded 503 problem. */
function unavailableGatewayContext(): never {
  throw problemException(
    503,
    'Trusted gateway context is unavailable',
    'gateway_context_unavailable',
  );
}

/**
 * Requires verifier key material that is long enough to authenticate gateway
 * workspace assertions. The returned value is safe to pass to the HMAC verifier.
 */
export function requireReviewGatewayContextSecret(secret: unknown): string {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES
  ) {
    return unavailableGatewayContext();
  }
  return secret;
}

/** Accepts only the exact method/path combinations exposed by Review. */
function requireReviewRequestBinding(binding: ReviewTrustedRequestBinding): {
  method: 'GET' | 'POST';
  path: string;
} {
  if (binding.method === 'GET' && binding.path === REVIEW_HISTORY_PATH) {
    return { method: 'GET', path: REVIEW_HISTORY_PATH };
  }
  if (
    binding.method === 'POST' &&
    typeof binding.path === 'string' &&
    REVIEW_COMPLETION_PATHS.has(binding.path)
  ) {
    return { method: 'POST', path: binding.path };
  }
  return invalidGatewayContext();
}

/**
 * Computes the SHA-256 HMAC over the Review-specific request-bound context.
 * The workspace ID must already be normalized to lowercase UUIDv4 form, so the
 * gateway signs that normalized identifier plus the exact HTTP method and path.
 */
function workspaceContextDigest(
  workspaceId: string,
  issuedAt: string,
  method: 'GET' | 'POST',
  path: string,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(
      `life-os.review-context.v1\n${workspaceId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest();
}

/**
 * Verifies the short-lived, method-and-path-bound workspace context created
 * after gateway authentication. A browser-selected workspace header is never
 * an authorization input, and a history context cannot be replayed as a write.
 */
export function requireTrustedWorkspaceContext(
  headers: ReviewTrustedWorkspaceContextHeaders,
  secret: unknown,
  requestBinding: ReviewTrustedRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const verifiedSecret = requireReviewGatewayContextSecret(secret);
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 0) {
    return unavailableGatewayContext();
  }
  const { method, path } = requireReviewRequestBinding(requestBinding);
  if (
    typeof headers.workspaceId !== 'string' ||
    typeof headers.issuedAt !== 'string' ||
    typeof headers.signature !== 'string' ||
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature)
  ) {
    return invalidGatewayContext();
  }

  let workspaceId: string;
  try {
    workspaceId = requireReviewWorkspaceId(headers.workspaceId);
  } catch {
    return invalidGatewayContext();
  }

  const issuedAtSeconds = Number(headers.issuedAt);
  if (
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
    verifiedSecret,
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

/** Requires a supported ritual kind from the bounded route parameter. */
export function requireRitualPath(value: string): ReviewRitualKind {
  try {
    return requireReviewRitualKind(value);
  } catch {
    throw problemException(
      400,
      'Review ritual kind is invalid',
      'invalid_ritual',
    );
  }
}

/** Requires a bounded deterministic history page size. */
export function requireHistoryLimit(value: string | undefined): number {
  try {
    return requireReviewLimit(value);
  } catch {
    throw problemException(
      400,
      'Review history limit is invalid',
      'invalid_limit',
    );
  }
}

/** Maps domain and persistence failures to credential-free HTTP problems. */
export function toReviewHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) return error;
  if (error instanceof ReviewCompletionConflictError) {
    return problemException(
      409,
      'Review completion conflicts with immutable evidence',
      'completion_conflict',
    );
  }
  if (error instanceof ReviewValidationError) {
    return problemException(
      400,
      'Review request is invalid',
      'invalid_request',
    );
  }
  if (error instanceof ReviewPersistenceError) {
    return problemException(
      503,
      'Review persistence is unavailable',
      'persistence_unavailable',
    );
  }
  return problemException(
    503,
    'Review service is unavailable',
    'service_unavailable',
  );
}
