import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import type { HabitDataRightsAuthorityReplayGuardPort } from './habit-data-rights-authority-replay';
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

/** Credential-free RFC 7807-style problem shape exposed by the private contributor transport. */
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

/** Canonical request with UUIDv4 tenant, actor, request, and destructive replay fields normalized to lowercase. */
type NormalizedRequest = HabitDataRightsRequest &
  Readonly<{
    workspaceId: string;
    requestedByUserId: string;
    requestId: string;
  }>;

/** Builds one bounded problem without reflecting untrusted request or dependency detail. */
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

/** Rejects malformed data-rights schema or identifier input as an HTTP 400 problem. */
function invalidRequest(): never {
  throw problemException(
    400,
    'Habit data-rights request is invalid',
    'invalid_data_rights_request',
  );
}

/** Rejects forged, replayed, stale, or route-mismatched authority as an HTTP 401 problem. */
function invalidContext(): never {
  throw problemException(
    401,
    'Habit data-rights authority is invalid',
    'invalid_data_rights_context',
  );
}

/** Rejects unavailable secret or replay-store authority as a credential-free HTTP 503 problem. */
function unavailableContext(): never {
  throw problemException(
    503,
    'Habit data-rights authority is unavailable',
    'data_rights_context_unavailable',
  );
}

/** Requires a plain JSON object before any caller field can influence authority. */
function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidRequest();
  }
  return value as Record<string, unknown>;
}

/** Requires an exact operation-specific field set so undeclared fields cannot alter downstream meaning. */
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

/** Normalizes exactly the v1 contributor request schema and rejects all other shapes. */
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

/** Requires the single POST route that owns the v1 Habit contributor transport. */
function requireRequestBinding(
  binding: HabitDataRightsRequestBinding,
): { readonly method: 'POST'; readonly path: typeof CONTRIBUTOR_PATH } {
  if (binding.method !== 'POST' || binding.path !== CONTRIBUTOR_PATH) {
    return invalidContext();
  }
  return { method: 'POST', path: CONTRIBUTOR_PATH };
}

/**
 * Computes the canonical HMAC over contract, tenant, actor, request, operation,
 * destructive idempotency key (or `-`), issuance time, method, and exact path in
 * that order. Any change to one field produces a different authority proof.
 */
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

/** Derives a credential-free replay identity from one already-canonical validated signature. */
function replayDigest(signature: string): string {
  return createHash('sha256').update(signature, 'ascii').digest('hex');
}

/** Converts the signed issuance time into the exact end of the 60-second authority lifetime. */
function replayExpiresAt(issuedAtSeconds: number): string {
  const expiresAt = new Date(
    (issuedAtSeconds + MAXIMUM_CONTEXT_AGE_SECONDS) * 1_000,
  );
  if (!Number.isFinite(expiresAt.getTime())) {
    return unavailableContext();
  }
  return expiresAt.toISOString();
}

/**
 * Parses one exact contributor request, verifies short-lived service authority,
 * and atomically consumes destructive `erase` evidence before persistence can run.
 *
 * The HMAC binds tenant, actor, request, purpose/operation, destructive idempotency
 * key, lifetime, HTTP method, and resource. Only the SHA-256 digest of a validated
 * signature is persisted for replay control; the short-lived signature itself is
 * never stored. Non-destructive operations remain replay-safe domain reads/checks
 * and do not consume the destructive replay store.
 */
export async function parseTrustedHabitDataRightsRequest(
  body: unknown,
  headers: TrustedHabitDataRightsContextHeaders,
  secret: unknown,
  requestBinding: HabitDataRightsRequestBinding,
  nowSeconds = Math.floor(Date.now() / 1000),
  replayGuard?: HabitDataRightsAuthorityReplayGuardPort,
): Promise<HabitDataRightsRequest> {
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

  if (request.operation === 'erase') {
    if (!replayGuard) {
      return unavailableContext();
    }
    let consumed: boolean;
    try {
      consumed = await replayGuard.consume({
        evidenceDigest: replayDigest(headers.signature),
        expiresAt: replayExpiresAt(issuedAtSeconds),
      });
    } catch {
      return unavailableContext();
    }
    if (!consumed) {
      return invalidContext();
    }
  }
  return request;
}

/** Maps every contributor/runtime failure to one bounded credential-free service error. */
export function toHabitDataRightsHttpException(error: unknown): HttpException {
  void error;
  return problemException(
    503,
    'Habit data-rights operation is unavailable',
    'data_rights_unavailable',
  );
}
