import { createHmac, timingSafeEqual } from 'node:crypto';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISSUED_AT_PATTERN = /^\d{10}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_CONTEXT_AGE_SECONDS = 60;
const MAXIMUM_FUTURE_SKEW_SECONDS = 5;
const WORKSPACE_CONTEXT_VERSION = 'life-os.calendar-workspace.v1';
const USER_CONTEXT_VERSION = 'life-os.calendar-user.v1';

/** Headers accepted from the trusted LifeOS gateway workspace boundary. */
export interface CalendarWorkspaceContextHeaders {
  readonly workspaceId: unknown;
  readonly issuedAt: unknown;
  readonly signature: unknown;
}

/** Headers accepted from the trusted LifeOS gateway workspace-user boundary. */
export interface CalendarUserContextHeaders extends CalendarWorkspaceContextHeaders {
  readonly userId: unknown;
}

/** Immutable authenticated calendar authority for one workspace and user. */
export interface TrustedCalendarUserContext {
  readonly workspaceId: string;
  readonly userId: string;
}

/** Marks a missing or unusable server-side verification configuration. */
export class CalendarContextUnavailableError extends Error {
  /** Creates a fixed configuration error without retaining secret material. */
  constructor() {
    super('trusted calendar context is unavailable');
    this.name = 'CalendarContextUnavailableError';
  }
}

/** Marks an untrusted, malformed, stale, or forged calendar context. */
export class CalendarContextInvalidError extends Error {
  /** Creates a fixed validation error without reflecting attacker input. */
  constructor() {
    super('trusted calendar context is invalid');
    this.name = 'CalendarContextInvalidError';
  }
}

function requireSecret(secret: unknown): string {
  if (
    typeof secret !== 'string' ||
    Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES
  ) {
    throw new CalendarContextUnavailableError();
  }
  return secret;
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new CalendarContextInvalidError();
  }
  return value.toLowerCase();
}

function requireIssuedAt(value: unknown, nowSeconds: number): string {
  if (typeof value !== 'string' || !ISSUED_AT_PATTERN.test(value)) {
    throw new CalendarContextInvalidError();
  }
  const issuedAt = Number(value);
  if (
    !Number.isSafeInteger(nowSeconds) ||
    !Number.isSafeInteger(issuedAt) ||
    issuedAt < nowSeconds - MAXIMUM_CONTEXT_AGE_SECONDS ||
    issuedAt > nowSeconds + MAXIMUM_FUTURE_SKEW_SECONDS
  ) {
    throw new CalendarContextInvalidError();
  }
  return value;
}

function workspaceSignature(
  workspaceId: string,
  issuedAt: string,
  secret: string,
): Buffer {
  return Buffer.from(
    createHmac('sha256', secret)
      .update(
        `${WORKSPACE_CONTEXT_VERSION}\n${workspaceId}\n${issuedAt}`,
        'utf8',
      )
      .digest('base64url'),
    'ascii',
  );
}

function userSignature(
  workspaceId: string,
  userId: string,
  issuedAt: string,
  secret: string,
): Buffer {
  return Buffer.from(
    createHmac('sha256', secret)
      .update(
        `${USER_CONTEXT_VERSION}\n${workspaceId}\n${userId}\n${issuedAt}`,
        'utf8',
      )
      .digest('base64url'),
    'ascii',
  );
}

function requireMatchingSignature(
  value: unknown,
  expected: Buffer,
): void {
  if (typeof value !== 'string' || !SIGNATURE_PATTERN.test(value)) {
    throw new CalendarContextInvalidError();
  }
  const provided = Buffer.from(value, 'ascii');
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  ) {
    throw new CalendarContextInvalidError();
  }
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
  const workspaceId = requireUuid(headers.workspaceId);
  const issuedAt = requireIssuedAt(headers.issuedAt, nowSeconds);
  requireMatchingSignature(
    headers.signature,
    workspaceSignature(workspaceId, issuedAt, safeSecret),
  );
  return workspaceId;
}

/**
 * Verifies one short-lived server-derived workspace-user context.
 *
 * The user-aware context intentionally uses a different versioned HMAC input
 * than the existing workspace-only synchronization context. A valid v1
 * workspace signature can therefore never be replayed as per-user connection
 * authority, and changing either opaque UUID invalidates the signature.
 */
export function requireTrustedCalendarUserContext(
  headers: CalendarUserContextHeaders,
  secret: unknown,
  nowSeconds = Math.floor(Date.now() / 1000),
): TrustedCalendarUserContext {
  const safeSecret = requireSecret(secret);
  const workspaceId = requireUuid(headers.workspaceId);
  const userId = requireUuid(headers.userId);
  const issuedAt = requireIssuedAt(headers.issuedAt, nowSeconds);
  requireMatchingSignature(
    headers.signature,
    userSignature(workspaceId, userId, issuedAt, safeSecret),
  );
  return Object.freeze({ workspaceId, userId });
}
