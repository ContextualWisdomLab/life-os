import type {
  CalendarConnectionSqlClient,
  CalendarConnectionSqlResult,
} from './calendar-connection-repository';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Validated authority required to revoke one calendar connection. */
export interface RevokeCalendarConnection {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly revokedAt: string;
}

/** Minimal immutable evidence returned after one successful revocation. */
export interface CalendarConnectionRevocationRecord {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly status: 'revoked';
  readonly revokedAt: string;
}

/** Fail-closed error for malformed revocation authority or timestamps. */
export class CalendarConnectionRevocationValidationError extends Error {
  /** Creates a bounded validation error without reflecting rejected input. */
  constructor() {
    super('Calendar connection revocation is invalid');
    this.name = 'CalendarConnectionRevocationValidationError';
  }
}

/** Fail-closed error for impossible or duplicated database revocation evidence. */
export class CalendarConnectionRevocationPersistenceError extends Error {
  /** Creates a bounded persistence error without exposing row contents. */
  constructor() {
    super('Persisted calendar connection revocation is invalid');
    this.name = 'CalendarConnectionRevocationPersistenceError';
  }
}

interface CalendarConnectionRevocationRow {
  connection_id: unknown;
  workspace_id: unknown;
  user_id: unknown;
  connection_status: unknown;
  revoked_at: unknown;
}

function invalidInput(): never {
  throw new CalendarConnectionRevocationValidationError();
}

function invalidPersistence(): never {
  throw new CalendarConnectionRevocationPersistenceError();
}

function requireInputUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidInput();
  }
  return value.toLowerCase();
}

function requireStoredUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidPersistence();
  }
  return value.toLowerCase();
}

function parseInstant(value: unknown, invalid: () => never): string {
  const candidate =
    value instanceof Date
      ? value.toISOString()
      : typeof value === 'string'
        ? value
        : '';
  if (!ISO_INSTANT_PATTERN.test(candidate)) {
    return invalid();
  }
  const parsed = new Date(candidate);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== candidate) {
    return invalid();
  }
  return candidate;
}

function validateInput(input: RevokeCalendarConnection): RevokeCalendarConnection {
  return Object.freeze({
    connectionId: requireInputUuid(input.connectionId),
    workspaceId: requireInputUuid(input.workspaceId),
    userId: requireInputUuid(input.userId),
    revokedAt: parseInstant(input.revokedAt, invalidInput),
  });
}

function exactlyOneOrUndefined<Row>(
  result: CalendarConnectionSqlResult<Row>,
): Row | undefined {
  if (result.rows.length > 1) {
    return invalidPersistence();
  }
  return result.rows[0];
}

function parseRevocation(
  row: CalendarConnectionRevocationRow,
  expected: RevokeCalendarConnection,
): CalendarConnectionRevocationRecord {
  const connectionId = requireStoredUuid(row.connection_id);
  const workspaceId = requireStoredUuid(row.workspace_id);
  const userId = requireStoredUuid(row.user_id);
  const revokedAt = parseInstant(row.revoked_at, invalidPersistence);
  if (
    row.connection_status !== 'revoked' ||
    connectionId !== expected.connectionId ||
    workspaceId !== expected.workspaceId ||
    userId !== expected.userId ||
    revokedAt !== expected.revokedAt
  ) {
    return invalidPersistence();
  }
  return Object.freeze({
    connectionId,
    workspaceId,
    userId,
    status: 'revoked',
    revokedAt,
  });
}

/**
 * Performs the tenant/user-scoped active-to-revoked calendar lifecycle transition.
 *
 * The single conditional UPDATE is the authority boundary: an absent, already
 * revoked, or differently owned connection returns no row and is indistinguishable
 * to the caller. No provider secret is read or returned during revocation.
 */
export class PostgresCalendarConnectionRevocationRepository {
  /** Creates the revocation adapter over the existing least-authority SQL port. */
  constructor(private readonly client: CalendarConnectionSqlClient) {}

  /** Atomically revokes the exact active connection or returns undefined. */
  async revokeConnection(
    input: RevokeCalendarConnection,
  ): Promise<CalendarConnectionRevocationRecord | undefined> {
    const safe = validateInput(input);
    const result = await this.client.query<CalendarConnectionRevocationRow>(
      `UPDATE calendar_integration.calendar_connection_record
       SET connection_status = 'revoked',
           revoked_at = $4::timestamptz,
           updated_at = $4::timestamptz
       WHERE connection_id = $1::uuid
         AND workspace_id = $2::uuid
         AND user_id = $3::uuid
         AND connection_status = 'active'
         AND created_at <= $4::timestamptz
       RETURNING connection_id, workspace_id, user_id, connection_status, revoked_at`,
      [safe.connectionId, safe.workspaceId, safe.userId, safe.revokedAt],
    );
    const row = exactlyOneOrUndefined(result);
    if (!row) {
      return undefined;
    }
    return parseRevocation(row, safe);
  }
}
