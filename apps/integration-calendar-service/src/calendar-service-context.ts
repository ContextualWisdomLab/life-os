import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISSUED_AT_PATTERN = /^\d{10}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
const CONTEXT_VERSION = 'life-os.calendar-workspace.v1';

/** Headers accepted from the trusted LifeOS gateway boundary. */
export interface CalendarWorkspaceContextHeaders {
  readonly workspaceId: unknown;
  readonly issuedAt: unknown;
  readonly signature: unknown;
}

function requireSecret(secret: unknown): string {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES
  ) {
    throw new Error('trusted calendar context is unavailable');
  }
  return secret;
}

function requireIssuedAt(value: unknown, nowSeconds: number): string {
  if (typeof value !== 'string' || !ISSUED_AT_PATTERN.test(value)) {
    throw new Error('trusted calendar context is invalid');
  }
  const issuedAt = Number(value);
  if (
    !Number.isSafeInteger(nowSeconds) ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS ||
    issuedAt > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS
  ) {
    throw new Error('trusted calendar context is invalid');
  }
  return value;
}

function expectedSignature(
  workspaceId: string,
  issuedAt: string,
  secret: string,
): Buffer {
  return Buffer.from(
    createHmac('sha256', secret)
      .update(`${CONTEXT_VERSION}\n${workspaceId}\n${issuedAt}`, 'utf8')
      .digest('base64url'),
    'ascii',
  );
}

/**
 * Verifies one short-lived server-derived workspace context and returns only
 * the authenticated UUIDv4 workspace identifier.
 */
export function requireTrustedCalendarWorkspaceContext(
  headers: CalendarWorkspaceContextHeaders,
  secret: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const safeSecret = requireSecret(secret);
  if (
    typeof headers.workspaceId !== 'string' ||
    !UUID_V4_PATTERN.test(headers.workspaceId) ||
    typeof headers.signature !== 'string' ||
    !SIGNATURE_PATTERN.test(headers.signature)
  ) {
    throw new Error('trusted calendar context is invalid');
  }
  const workspaceId = headers.workspaceId.toLowerCase();
  const issuedAt = requireIssuedAt(headers.issuedAt, nowSeconds);
  const providedSignature = Buffer.from(headers.signature, 'ascii');
  const canonicalSignature = expectedSignature(workspaceId, issuedAt, safeSecret);
  if (
    providedSignature.length !== canonicalSignature.length ||
    !timingSafeEqual(providedSignature, canonicalSignature)
  ) {
    throw new Error('trusted calendar context is invalid');
  }
  return workspaceId;
}
