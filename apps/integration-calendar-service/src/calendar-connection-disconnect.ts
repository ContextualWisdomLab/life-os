import type { TrustedCalendarUserContext } from './calendar-service-context';
import type {
  CalendarConnectionRevocationRecord,
  RevokeCalendarConnection,
} from './calendar-connection-revocation';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Least-authority persistence port required to disconnect one calendar connection. */
export interface CalendarConnectionRevocationPort {
  revokeConnection(
    input: RevokeCalendarConnection,
  ): Promise<CalendarConnectionRevocationRecord | undefined>;
}

/** Public credential-free result returned after a successful local disconnect. */
export interface CalendarConnectionDisconnectResult {
  readonly connectionId: string;
  readonly status: 'revoked';
  readonly revokedAt: string;
}

/** Rejects malformed user-facing disconnect input before persistence is called. */
export class CalendarConnectionDisconnectValidationError extends Error {
  /** Creates a fixed validation error without retaining attacker-controlled input. */
  constructor() {
    super('Calendar connection disconnect input is invalid');
    this.name = 'CalendarConnectionDisconnectValidationError';
  }
}

/** Rejects persistence evidence that does not match the trusted disconnect authority. */
export class CalendarConnectionDisconnectEvidenceError extends Error {
  /** Creates a fixed evidence error without exposing durable row contents. */
  constructor() {
    super('Calendar connection disconnect evidence is invalid');
    this.name = 'CalendarConnectionDisconnectEvidenceError';
  }
}

/** Returns one canonical lower-case UUIDv4 or fails before persistence. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new CalendarConnectionDisconnectValidationError();
  }
  return value.toLowerCase();
}

/** Returns the server clock as one canonical UTC instant or fails closed. */
function requireRevokedAt(now: () => Date): string {
  let value: string;
  try {
    value = now().toISOString();
  } catch {
    throw new CalendarConnectionDisconnectValidationError();
  }
  if (!ISO_INSTANT_PATTERN.test(value)) {
    throw new CalendarConnectionDisconnectValidationError();
  }
  return value;
}

/** Verifies that persistence returned exactly the authenticated authority and request. */
function validateRevocationEvidence(
  record: CalendarConnectionRevocationRecord,
  expected: RevokeCalendarConnection,
): CalendarConnectionDisconnectResult {
  if (
    record.status !== 'revoked' ||
    record.connectionId !== expected.connectionId ||
    record.workspaceId !== expected.workspaceId ||
    record.userId !== expected.userId ||
    record.revokedAt !== expected.revokedAt
  ) {
    throw new CalendarConnectionDisconnectEvidenceError();
  }
  return Object.freeze({
    connectionId: record.connectionId,
    status: 'revoked',
    revokedAt: record.revokedAt,
  });
}

/** Application boundary for an authenticated user disconnecting one owned connection. */
export class CalendarConnectionDisconnectApplication {
  /** Creates the application over a tenant/user-scoped revocation port. */
  constructor(
    private readonly revocations: CalendarConnectionRevocationPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Disconnects one owned connection without returning provider credential material. */
  async disconnect(
    authority: TrustedCalendarUserContext,
    connectionId: string,
  ): Promise<CalendarConnectionDisconnectResult | undefined> {
    const input = Object.freeze({
      connectionId: requireUuid(connectionId),
      workspaceId: requireUuid(authority.workspaceId),
      userId: requireUuid(authority.userId),
      revokedAt: requireRevokedAt(this.now),
    });
    const record = await this.revocations.revokeConnection(input);
    return record ? validateRevocationEvidence(record, input) : undefined;
  }
}
