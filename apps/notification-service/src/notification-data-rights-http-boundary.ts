import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import {
  NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
  type NotificationDataRightsRequest,
} from './notification-data-rights';

/** Short-lived service-authentication headers for the private Notification contributor route. */
export interface TrustedNotificationDataRightsContextHeaders {
  readonly issuedAt: unknown;
  readonly signature: unknown;
}

/** Server-observed HTTP identity bound into one Notification contributor authorization proof. */
export interface NotificationDataRightsRequestBinding {
  readonly method: unknown;
  readonly path: unknown;
}

interface NotificationDataRightsProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const BASE64URL_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CONTRIBUTOR_PATH = '/v1/internal/data-rights/contributor';
const MINIMUM_CONTEXT_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
const MAXIMUM_CURSOR_BYTES = 512;

type NormalizedRequest = NotificationDataRightsRequest &
  Readonly<{
    workspaceId: string;
    requestedByUserId: string;
    requestId: string;
  }>;

/** Builds one bounded RFC 7807-style transport problem without reflecting untrusted data. */
function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const problem: NotificationDataRightsProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

/** Rejects malformed contributor request data before Notification persistence can observe it. */
function invalidRequest(): never {
  throw problemException(
    400,
    'Notification data-rights request is invalid',
    'invalid_data_rights_request',
  );
}

/** Rejects forged, stale, future, or route-mismatched service authority. */
function invalidContext(): never {
  throw problemException(
    401,
    'Notification data-rights authority is invalid',
    'invalid_data_rights_context',
  );
}

/** Rejects verifier configuration that cannot authenticate the internal caller. */
function unavailableContext(): never {
  throw problemException(
    503,
    'Notification data-rights authority is unavailable',
    'data_rights_context_unavailable',
  );
}

/** Requires one ordinary JSON object so prototypes cannot add hidden authority fields. */
function requireRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return invalidRequest();
  }
  return value as Record<string, unknown>;
}

/** Requires exactly the documented operation-specific fields. */
function requireExactKeys(
  record: Record<string, unknown>,
  expectedKeys: readonly string[],
): void {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(record);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    invalidRequest();
  }
}

/** Requires and canonicalizes one opaque UUIDv4 product identity. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidRequest();
  }
  return value.toLowerCase();
}

/** Requires the bounded opaque pagination token; semantic cursor validation remains contributor-owned. */
function requireCursor(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'ascii') > MAXIMUM_CURSOR_BYTES ||
    !BASE64URL_CURSOR_PATTERN.test(value)
  ) {
    return invalidRequest();
  }
  return value;
}

/** Normalizes exactly the private Notification v1 contributor request schema. */
function normalizeRequest(body: unknown): NormalizedRequest {
  const request = requireRecord(body);
  const commonKeys = [
    'contractVersion',
    'operation',
    'workspaceId',
    'requestedByUserId',
    'requestId',
  ] as const;
  if (
    request.contractVersion !== NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION ||
    (request.operation !== 'export' &&
      request.operation !== 'erase_preflight' &&
      request.operation !== 'erase' &&
      request.operation !== 'verify_erased')
  ) {
    return invalidRequest();
  }

  const workspaceId = requireUuidV4(request.workspaceId);
  const requestedByUserId = requireUuidV4(request.requestedByUserId);
  const requestId = requireUuidV4(request.requestId);

  if (request.operation === 'export') {
    const hasCursor = Object.prototype.hasOwnProperty.call(request, 'cursor');
    requireExactKeys(request, hasCursor ? [...commonKeys, 'cursor'] : commonKeys);
    return {
      contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
      operation: 'export',
      workspaceId,
      requestedByUserId,
      requestId,
      ...(hasCursor ? { cursor: requireCursor(request.cursor) } : {}),
    };
  }

  if (request.operation === 'erase') {
    requireExactKeys(request, [...commonKeys, 'idempotencyKey']);
    return {
      contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
      operation: 'erase',
      workspaceId,
      requestedByUserId,
      requestId,
      idempotencyKey: requireUuidV4(request.idempotencyKey),
    };
  }

  requireExactKeys(request, commonKeys);
  return {
    contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
    operation: request.operation,
    workspaceId,
    requestedByUserId,
    requestId,
  };
}

/** Requires the one exact private POST resource that owns Notification contributor transport. */
function requireRequestBinding(
  binding: NotificationDataRightsRequestBinding,
): { readonly method: 'POST'; readonly path: typeof CONTRIBUTOR_PATH } {
  if (binding.method !== 'POST' || binding.path !== CONTRIBUTOR_PATH) {
    return invalidContext();
  }
  return { method: 'POST', path: CONTRIBUTOR_PATH };
}

/** Computes the request-bound HMAC over every field that can change tenant or operation meaning. */
function requestDigest(
  request: NormalizedRequest,
  issuedAt: string,
  binding: Readonly<{ method: 'POST'; path: typeof CONTRIBUTOR_PATH }>,
  secret: string,
): Buffer {
  const idempotencyKey =
    request.operation === 'erase' ? request.idempotencyKey : '-';
  const cursor =
    request.operation === 'export' ? (request.cursor ?? '-') : '-';
  return createHmac('sha256', secret)
    .update(
      [
        'life-os.notification-data-rights-context.v1',
        request.contractVersion,
        request.workspaceId,
        request.requestedByUserId,
        request.requestId,
        request.operation,
        idempotencyKey,
        cursor,
        issuedAt,
        binding.method,
        binding.path,
      ].join('\n'),
      'utf8',
    )
    .digest();
}

/**
 * Verifies one exact Identity-to-Notification contributor request before persistence access.
 *
 * Tenant, actor, request, operation, destructive idempotency identity, export
 * continuation, lifetime, HTTP method, and resource are HMAC-bound. The function
 * returns only normalized request data and never forwards the verifier secret or
 * signature to the contributor. Cursor semantics remain owned by the Notification
 * contributor so transport authentication cannot become a second source of truth.
 */
export async function parseTrustedNotificationDataRightsRequest(
  body: unknown,
  headers: TrustedNotificationDataRightsContextHeaders,
  secret: unknown,
  requestBinding: NotificationDataRightsRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<NotificationDataRightsRequest> {
  const request = normalizeRequest(body);
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_CONTEXT_SECRET_BYTES
  ) {
    return unavailableContext();
  }
  const binding = requireRequestBinding(requestBinding);
  if (
    typeof headers.issuedAt !== 'string' ||
    typeof headers.signature !== 'string' ||
    !UNIX_SECONDS_PATTERN.test(headers.issuedAt) ||
    !BASE64URL_SHA256_PATTERN.test(headers.signature) ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 0
  ) {
    return invalidContext();
  }

  const issuedAtSeconds = Number(headers.issuedAt);
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    issuedAtSeconds > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS ||
    issuedAtSeconds < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS
  ) {
    return invalidContext();
  }

  const expected = requestDigest(request, headers.issuedAt, binding, secret);
  const actual = Buffer.from(headers.signature, 'base64url');
  if (
    actual.length !== expected.length ||
    actual.toString('base64url') !== headers.signature ||
    !timingSafeEqual(actual, expected)
  ) {
    return invalidContext();
  }
  return request;
}

/** Maps contributor/runtime failures to one credential-free private transport error. */
export function toNotificationDataRightsHttpException(
  error: unknown,
): HttpException {
  void error;
  return problemException(
    503,
    'Notification data-rights operation is unavailable',
    'data_rights_unavailable',
  );
}
