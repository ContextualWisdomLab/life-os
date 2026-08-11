import type { TrustedCalendarUserContext } from './calendar-service-context';
import type {
  CalendarConnectionRecord,
  CalendarConnectionProvider,
  GetActiveCalendarConnection,
} from './calendar-connection-repository';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

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

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new CalendarConnectionReadValidationError();
  }
  return value.toLowerCase();
}

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
  return Object.freeze({
    connectionId: record.connectionId,
    providerCode: record.providerCode,
    scopeValues: Object.freeze([...record.scopeValues]),
    tokenExpiresAt: record.tokenExpiresAt,
    selectedCalendarIdentifier: record.selectedCalendarIdentifier,
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
