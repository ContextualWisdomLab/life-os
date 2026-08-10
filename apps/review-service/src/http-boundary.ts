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

const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;

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

function invalidGatewayContext(): never {
  throw problemException(
    401,
    'Trusted gateway context is invalid',
    'invalid_gateway_context',
  );
}

function unavailableGatewayContext(): never {
  throw problemException(
    503,
    'Trusted gateway context is unavailable',
    'gateway_context_unavailable',
  );
}

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
 * Verifies the short-lived workspace context created after gateway authentication.
 * A browser-selected workspace header is intentionally not an authorization input.
 */
export function requireTrustedWorkspaceContext(
  headers: ReviewTrustedWorkspaceContextHeaders,
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
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
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
