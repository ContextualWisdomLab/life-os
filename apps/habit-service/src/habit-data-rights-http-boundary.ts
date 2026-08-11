import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  type HabitDataRightsRequest,
} from './habit-data-rights';

/** Short-lived service-authentication headers for the internal contributor route. */
export interface TrustedHabitDataRightsContextHeaders {
  readonly issuedAt: unknown;
  readonly signature: unknown;
}

/** Server-owned HTTP identity bound into one contributor authorization digest. */
export interface HabitDataRightsRequestBinding {
  readonly method: unknown;
  readonly path: unknown;
}

interface HabitDataRightsProblemDetails {
  readonly type: 'about:blank';
  readonly title: string;
  readonly status: number;
  readonly code: string;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UNIX_SECONDS_PATTERN = /^(?:0|[1-9]\d{0,12})$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CONTRIBUTOR_PATH = '/v1/internal/data-rights/contributor';
const MINIMUM_CONTEXT_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;

type NormalizedRequest = HabitDataRightsRequest &
  Readonly<{
    workspaceId: string;
    requestedByUserId: string;
    requestId: string;
  }>;

function problemException(
  status: number,
  title: string,
  code: string,
): HttpException {
  const problem: HabitDataRightsProblemDetails = {
    type: 'about:blank',
    title,
    status,
    code,
  };
  return new HttpException(problem, status);
}

function invalidRequest(): never {
  throw problemException(
    400,
    'Habit data-rights request is invalid',
    'invalid_data_rights_request',
  );
}

function invalidContext(): never {
  throw problemException(
    401,
    'Habit data-rights authority is invalid',
    'invalid_data_rights_context',
  );
}

function unavailableContext(): never {
  throw problemException(
    503,
    'Habit data-rights authority is unavailable',
    'data_rights_context_unavailable',
  );
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidRequest();
  }
  return value as Record<string, unknown>;
}

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

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidRequest();
  }
  return value.toLowerCase();
}

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

function requireRequestBinding(
  binding: HabitDataRightsRequestBinding,
): { readonly method: 'POST'; readonly path: typeof CONTRIBUTOR_PATH } {
  if (binding.method !== 'POST' || binding.path !== CONTRIBUTOR_PATH) {
    return invalidContext();
  }
  return { method: 'POST', path: CONTRIBUTOR_PATH };
}

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
        'life-os.habit-data-rights-context.v1',
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
 * Parses one exact contributor request and verifies short-lived service authority.
 * The HMAC binds tenant, actor, request, purpose/operation, destructive replay key,
 * lifetime, HTTP method, and resource so credentials cannot authorize another call.
 */
export function parseTrustedHabitDataRightsRequest(
  body: unknown,
  headers: TrustedHabitDataRightsContextHeaders,
  secret: unknown,
  requestBinding: HabitDataRightsRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
): HabitDataRightsRequest {
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

/** Maps contributor/runtime failures to a bounded credential-free service error. */
export function toHabitDataRightsHttpException(error: unknown): HttpException {
  if (error instanceof HttpException) {
    return error;
  }
  return problemException(
    503,
    'Habit data-rights operation is unavailable',
    'data_rights_unavailable',
  );
}
