import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { TrustedHabitWorkspaceContextHeaders } from './http-boundary';

/** Server-owned Habit request identity bound into a gateway context. */
export interface HabitTrustedRequestBinding {
  method: unknown;
  path: unknown;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_GATEWAY_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
export const HABIT_REVIEW_PROJECTION_PATH = '/v1/habits/review-projection';

/** Builds a credential-free HTTP problem for request-bound Habit authority. */
function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  return new HttpException(
    { type: 'about:blank', title, status, code },
    status,
  );
}

/** Rejects malformed, stale, future-dated, forged, or replayed Habit context. */
function invalidGatewayContext(): never {
  throw problemException(
    401,
    'Trusted gateway context is invalid',
    'invalid_gateway_context',
  );
}

/** Rejects requests when Habit cannot verify the gateway context. */
function unavailableGatewayContext(): never {
  throw problemException(
    503,
    'Trusted gateway context is unavailable',
    'gateway_context_unavailable',
  );
}

/** Accepts only the exact read path used for the Habit Weekly Review projection. */
function requireReviewProjectionBinding(
  binding: HabitTrustedRequestBinding,
): { method: 'GET'; path: typeof HABIT_REVIEW_PROJECTION_PATH } {
  if (
    binding.method !== 'GET' ||
    binding.path !== HABIT_REVIEW_PROJECTION_PATH
  ) {
    return invalidGatewayContext();
  }
  return { method: 'GET', path: HABIT_REVIEW_PROJECTION_PATH };
}

/** Computes the request-bound Habit v2 HMAC shared with trusted server callers. */
function requestContextDigest(
  workspaceId: string,
  issuedAt: string,
  method: 'GET',
  path: typeof HABIT_REVIEW_PROJECTION_PATH,
  secret: string,
): Buffer {
  return createHmac('sha256', secret)
    .update(
      `life-os.habit-context.v2\n${workspaceId}\n${issuedAt}\n${method}\n${path}`,
      'utf8',
    )
    .digest();
}

/**
 * Verifies the short-lived request-bound context for Habit Review evidence.
 * A legacy workspace-only signature cannot be replayed onto this projection.
 */
export function requireTrustedReviewProjectionContext(
  headers: TrustedHabitWorkspaceContextHeaders,
  secret: unknown,
  requestBinding: HabitTrustedRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_GATEWAY_SECRET_BYTES
  ) {
    return unavailableGatewayContext();
  }
  const { method, path } = requireReviewProjectionBinding(requestBinding);
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

  const expected = requestContextDigest(
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

/** Requires a real Monday local date before invoking the Habit projection. */
export function requireReviewPeriodStartDate(value: string | undefined): string {
  if (typeof value !== 'string') {
    throw problemException(400, 'Review period is invalid', 'invalid_review_period');
  }
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) {
    throw problemException(400, 'Review period is invalid', 'invalid_review_period');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCDay() !== 1
  ) {
    throw problemException(400, 'Review period is invalid', 'invalid_review_period');
  }
  return value;
}
