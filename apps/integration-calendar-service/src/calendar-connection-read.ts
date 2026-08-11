import type { TrustedCalendarUserContext } from './calendar-service-context';
import type {
  CalendarConnectionRecord,
  CalendarConnectionProvider,
  GetActiveCalendarConnection,
} from './calendar-connection-repository';

/** Accepts canonical UUIDv4 identifiers; successful values are normalized to lowercase. */
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAXIMUM_SCOPE_COUNT = 32;
const MAXIMUM_SCOPE_LENGTH = 128;
const MAXIMUM_CALENDAR_IDENTIFIER_LENGTH = 1024;

/** Least-authority persistence port required to read one active connection. */
export interface CalendarConnectionReadPort {
  getActiveConnection(
    input: GetActiveCalendarConnection,
  ): Promise<CalendarConnectionRecord | undefined>;
}

/** Credential-free lifecycle projection safe for an authenticated connection owner. */
export interface CalendarConnectionReadResult {
  readonly connectionId: string;
  readonly providerCode: CalendarConnectionProvider;
  readonly scopeValues: readonly string[];
  readonly tokenExpiresAt: string;
  readonly selectedCalendarIdentifier: string;
  readonly status: 'active';
}

/** Rejects malformed connection-read input before persistence is called. */
export class CalendarConnectionReadValidationError extends Error {
  /** Creates a fixed validation error without retaining attacker-controlled input. */
  constructor() {
    super('Calendar connection read input is invalid');
    this.name = 'CalendarConnectionReadValidationError';
  }
}

/** Rejects persistence evidence that contradicts authenticated read authority. */
export class CalendarConnectionReadEvidenceError extends Error {
  /** Creates a fixed evidence error without exposing persisted credential metadata. */
  constructor() {
    super('Calendar connection read evidence is invalid');
    this.name = 'CalendarConnectionReadEvidenceError';
  }
}

/** Validate one opaque UUIDv4 authority identifier and return its lowercase form. */
function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new CalendarConnectionReadValidationError();
  }
  return value.toLowerCase();
}

/** Reject a persisted provider code that is outside the supported public contract. */
function requireStoredProvider(value: unknown): CalendarConnectionProvider {
  if (value !== 'google' && value !== 'caldav') {
    throw new CalendarConnectionReadEvidenceError();
  }
  return value;
}

/** Reject a persisted instant unless it is a finite canonical millisecond UTC value. */
function requireStoredInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    throw new CalendarConnectionReadEvidenceError();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new CalendarConnectionReadEvidenceError();
  }
  return value;
}

/** Validate and bound one public persisted text field without retaining invalid input. */
function requireStoredText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new CalendarConnectionReadEvidenceError();
  }
  return value;
}

/** Validate, bound, and preserve the canonical sorted scope-list representation. */
function requireStoredScopes(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAXIMUM_SCOPE_COUNT
  ) {
    throw new CalendarConnectionReadEvidenceError();
  }
  const scopes = value.map((scope) =>
    requireStoredText(scope, MAXIMUM_SCOPE_LENGTH),
  );
  const canonical = [...new Set(scopes)].sort();
  if (
    canonical.length !== scopes.length ||
    canonical.some((scope, index) => scope !== scopes[index])
  ) {
    throw new CalendarConnectionReadEvidenceError();
  }
  return Object.freeze(canonical);
}

/**
 * Verify storage evidence against authenticated authority and project only
 * bounded, credential-free lifecycle fields.
 */
function projectConnection(
  record: CalendarConnectionRecord,
  expected: GetActiveCalendarConnection,
): CalendarConnectionReadResult {
  if (
    record.status !== 'active' ||
    record.connectionId !== expected.connectionId ||
    record.workspaceId !== expected.workspaceId ||
    record.userId !== expected.userId
  ) {
    throw new CalendarConnectionReadEvidenceError();
  }
  const providerCode = requireStoredProvider(record.providerCode);
  const scopeValues = requireStoredScopes(record.scopeValues);
  const tokenExpiresAt = requireStoredInstant(record.tokenExpiresAt);
  const selectedCalendarIdentifier = requireStoredText(
    record.selectedCalendarIdentifier,
    MAXIMUM_CALENDAR_IDENTIFIER_LENGTH,
  );
  return Object.freeze({
    connectionId: record.connectionId,
    providerCode,
    scopeValues,
    tokenExpiresAt,
    selectedCalendarIdentifier,
    status: 'active',
  });
}

/** Application boundary for an authenticated user reading one owned active connection. */
export class CalendarConnectionReadApplication {
  /** Creates the application over a tenant/user-scoped read port. */
  constructor(private readonly reads: CalendarConnectionReadPort) {}

  /** Returns bounded lifecycle evidence without exposing provider secret handles. */
  async getActive(
    authority: TrustedCalendarUserContext,
    connectionId: string,
  ): Promise<CalendarConnectionReadResult | undefined> {
    const input = Object.freeze({
      connectionId: requireUuid(connectionId),
      workspaceId: requireUuid(authority.workspaceId),
      userId: requireUuid(authority.userId),
    });
    const record = await this.reads.getActiveConnection(input);
    return record ? projectConnection(record, input) : undefined;
  }
}
