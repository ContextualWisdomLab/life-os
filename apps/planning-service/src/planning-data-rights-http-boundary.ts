import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  type DataRightsContributorRequest,
} from './planning-data-rights';

/** Short-lived service-authentication headers for the internal Planning contributor route. */
export interface TrustedPlanningDataRightsContextHeaders {
  readonly issuedAt: unknown;
  readonly signature: unknown;
}

/** Server-observed HTTP identity bound into one Planning data-rights proof. */
export interface PlanningDataRightsRequestBinding {
  readonly method: unknown;
  readonly path: unknown;
}

interface PlanningDataRightsProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CONTRIBUTOR_PATH = '/v1/internal/data-rights/contributor';
const MINIMUM_CONTEXT_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;

type NormalizedRequest = DataRightsContributorRequest &
  Readonly<{
    workspaceId: string;
    requestedByUserId: string;
    requestId: string;
  }>;

/** Builds one bounded RFC 7807-style problem without reflecting untrusted detail. */
function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const problem: PlanningDataRightsProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

/** Rejects malformed contributor request data before it reaches Planning persistence. */
function invalidRequest(): never {
  throw problemException(
    400,
    'Planning data-rights request is invalid',
    'invalid_data_rights_request',
  );
}

/** Rejects forged, stale, future, or route-mismatched service authority. */
function invalidContext(): never {
  throw problemException(
    401,
    'Planning data-rights authority is invalid',
    'invalid_data_rights_context',
  );
}

/** Rejects verifier configuration that cannot authenticate an internal caller. */
function unavailableContext(): never {
  throw problemException(
    503,
    'Planning data-rights authority is unavailable',
    'data_rights_context_unavailable',
  );
}

/** Requires a plain JSON object before any field can influence authority. */
function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidRequest();
  }
  return value as Record<string, unknown>;
}

/** Requires an exact operation-specific field set with no undeclared authority input. */
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

/** Normalizes exactly the protected v1 contributor request schema. */
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
    request.contractVersion !== DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION ||
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
  if (request.operation === 'erase') {
    requireExactKeys(request, [...commonKeys, 'idempotencyKey']);
    return {
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'erase',
      workspaceId,
      requestedByUserId,
      requestId,
      idempotencyKey: requireUuidV4(request.idempotencyKey),
    };
  }

  requireExactKeys(request, commonKeys);
  return {
    contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
    operation: request.operation,
    workspaceId,
    requestedByUserId,
    requestId,
  };
}

/** Requires the one exact POST resource that owns Planning contributor transport. */
function requireRequestBinding(
  binding: PlanningDataRightsRequestBinding,
): { readonly method: 'POST'; readonly path: typeof CONTRIBUTOR_PATH } {
  if (binding.method !== 'POST' || binding.path !== CONTRIBUTOR_PATH) {
    return invalidContext();
  }
  return { method: 'POST', path: CONTRIBUTOR_PATH };
}

/** Computes the canonical request-bound HMAC for one normalized contributor operation. */
function requestDigest(
  request: NormalizedRequest,
  issuedAt: string,
  binding: Readonly<{ method: 'POST'; path: typeof CONTRIBUTOR_PATH }>,
  secret: string,
): Buffer {
  const idempotencyKey =
    request.operation === 'erase' ? request.idempotencyKey : '-';
  return createHmac('sha256', secret)
    .update(
      [
        'life-os.planning-data-rights-context.v1',
        request.contractVersion,
        request.workspaceId,
        request.requestedByUserId,
        request.requestId,
        request.operation,
        idempotencyKey,
        issuedAt,
        binding.method,
        binding.path,
      ].join('\n'),
      'utf8',
    )
    .digest();
}

/**
 * Validates the exact contributor request and short-lived Identity-to-Planning authority.
 *
 * Tenant, actor, request, operation, destructive idempotency identity, lifetime,
 * method, and route are all HMAC-bound. The existing Planning contributor remains
 * the sole persistence authority and preserves its durable idempotent erase receipt.
 */
export async function parseTrustedPlanningDataRightsRequest(
  body: unknown,
  headers: TrustedPlanningDataRightsContextHeaders,
  secret: unknown,
  requestBinding: PlanningDataRightsRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<DataRightsContributorRequest> {
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

/** Maps contributor/runtime failures to one bounded credential-free transport error. */
export function toPlanningDataRightsHttpException(error: unknown): HttpException {
  void error;
  return problemException(
    503,
    'Planning data-rights operation is unavailable',
    'data_rights_unavailable',
  );
}
