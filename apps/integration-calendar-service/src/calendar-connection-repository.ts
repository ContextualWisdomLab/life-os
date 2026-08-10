const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SECRET_HANDLE_PATTERN =
  /^[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s\u0000-\u001f\u007f]{1,1024}$/u;

const MAXIMUM_PROVIDER_SUBJECT_LENGTH = 512;
const MAXIMUM_SCOPE_COUNT = 32;
const MAXIMUM_SCOPE_LENGTH = 128;
const MAXIMUM_CALENDAR_IDENTIFIER_LENGTH = 1024;

/** Query result exposed by the bounded calendar-connection persistence adapter. */
export interface CalendarConnectionSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal fixed-query SQL boundary required by the calendar connection registry. */
export interface CalendarConnectionSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<CalendarConnectionSqlResult<Row>>;
}

/** Calendar providers supported by the current LifeOS integration boundary. */
export type CalendarConnectionProvider = 'google' | 'caldav';

/** Durable lifecycle values exposed by the connection registry. */
export type CalendarConnectionStatus = 'active' | 'revoked';

/** Credential-free persisted calendar connection metadata. */
export interface CalendarConnectionRecord {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly providerCode: CalendarConnectionProvider;
  readonly providerAccountSubject: string;
  readonly scopeValues: readonly string[];
  readonly accessSecretHandle: string;
  readonly refreshSecretHandle: string | null;
  readonly tokenExpiresAt: string;
  readonly selectedCalendarIdentifier: string;
  readonly status: CalendarConnectionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revokedAt: string | null;
}

/** Validated input for creating one tenant/user-owned calendar connection. */
export interface CreateCalendarConnection {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly providerCode: CalendarConnectionProvider;
  readonly providerAccountSubject: string;
  readonly scopeValues: readonly string[];
  readonly accessSecretHandle: string;
  readonly refreshSecretHandle: string | null;
  readonly tokenExpiresAt: string;
  readonly selectedCalendarIdentifier: string;
  readonly createdAt: string;
}

/** Validated input for tenant/user-scoped active connection lookup. */
export interface GetActiveCalendarConnection {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly userId: string;
}

/** Fail-closed error for malformed calendar-connection input. */
export class CalendarConnectionValidationError extends Error {
  /** Creates a bounded validation error without retaining the rejected value. */
  constructor() {
    super('Calendar connection is invalid');
    this.name = 'CalendarConnectionValidationError';
  }
}

/** Stable conflict when a requested durable connection identity already exists. */
export class CalendarConnectionConflictError extends Error {
  /** Creates a credential-free connection conflict. */
  constructor() {
    super('Calendar connection conflicts with durable evidence');
    this.name = 'CalendarConnectionConflictError';
  }
}

/** Fail-closed error when stored connection evidence violates registry invariants. */
export class CalendarConnectionPersistenceError extends Error {
  /** Creates a fixed persistence-corruption error. */
  constructor() {
    super('Persisted calendar connection is invalid');
    this.name = 'CalendarConnectionPersistenceError';
  }
}

interface CalendarConnectionRow {
  connection_id: unknown;
  workspace_id: unknown;
  user_id: unknown;
  provider_code: unknown;
  provider_account_subject: unknown;
  scope_values: unknown;
  access_secret_handle: unknown;
  refresh_secret_handle: unknown;
  token_expires_at: unknown;
  selected_calendar_identifier: unknown;
  connection_status: unknown;
  created_at: unknown;
  updated_at: unknown;
  revoked_at: unknown;
}

function invalidInput(): never {
  throw new CalendarConnectionValidationError();
}

function invalidPersistence(): never {
  throw new CalendarConnectionPersistenceError();
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

function requireInputInstant(value: unknown): string {
  return parseInstant(value, invalidInput);
}

function requireStoredInstant(value: unknown): string {
  return parseInstant(value, invalidPersistence);
}

function requireInputProvider(value: unknown): CalendarConnectionProvider {
  if (value !== 'google' && value !== 'caldav') {
    return invalidInput();
  }
  return value;
}

function requireStoredProvider(value: unknown): CalendarConnectionProvider {
  if (value !== 'google' && value !== 'caldav') {
    return invalidPersistence();
  }
  return value;
}

function requireStoredStatus(value: unknown): CalendarConnectionStatus {
  if (value !== 'active' && value !== 'revoked') {
    return invalidPersistence();
  }
  return value;
}

function requireBoundedInputText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidInput();
  }
  return value;
}

function requireBoundedStoredText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidPersistence();
  }
  return value;
}

function requireInputSecretHandle(value: unknown): string {
  if (typeof value !== 'string' || !SECRET_HANDLE_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

function requireStoredSecretHandle(value: unknown): string {
  if (typeof value !== 'string' || !SECRET_HANDLE_PATTERN.test(value)) {
    return invalidPersistence();
  }
  return value;
}

function normalizeInputScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_SCOPE_COUNT) {
    return invalidInput();
  }
  const scopes = value.map((scope) =>
    requireBoundedInputText(scope, MAXIMUM_SCOPE_LENGTH),
  );
  const normalized = [...new Set(scopes)].sort();
  if (normalized.length === 0 || normalized.length > MAXIMUM_SCOPE_COUNT) {
    return invalidInput();
  }
  return Object.freeze(normalized);
}

function requireStoredScopes(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAXIMUM_SCOPE_COUNT) {
    return invalidPersistence();
  }
  const scopes = value.map((scope) =>
    requireBoundedStoredText(scope, MAXIMUM_SCOPE_LENGTH),
  );
  const normalized = [...new Set(scopes)].sort();
  if (
    normalized.length !== scopes.length ||
    normalized.some((scope, index) => scope !== scopes[index])
  ) {
    return invalidPersistence();
  }
  return Object.freeze(normalized);
}

function parseStoredConnection(row: CalendarConnectionRow): CalendarConnectionRecord {
  const status = requireStoredStatus(row.connection_status);
  const createdAt = requireStoredInstant(row.created_at);
  const updatedAt = requireStoredInstant(row.updated_at);
  const expiresAt = requireStoredInstant(row.token_expires_at);
  const revokedAt = row.revoked_at === null ? null : requireStoredInstant(row.revoked_at);
  if (
    new Date(updatedAt).getTime() < new Date(createdAt).getTime() ||
    new Date(expiresAt).getTime() <= new Date(createdAt).getTime() ||
    (status === 'active' && revokedAt !== null) ||
    (status === 'revoked' && revokedAt === null) ||
    (revokedAt !== null && new Date(revokedAt).getTime() < new Date(createdAt).getTime())
  ) {
    return invalidPersistence();
  }
  return Object.freeze({
    connectionId: requireStoredUuid(row.connection_id),
    workspaceId: requireStoredUuid(row.workspace_id),
    userId: requireStoredUuid(row.user_id),
    providerCode: requireStoredProvider(row.provider_code),
    providerAccountSubject: requireBoundedStoredText(
      row.provider_account_subject,
      MAXIMUM_PROVIDER_SUBJECT_LENGTH,
    ),
    scopeValues: requireStoredScopes(row.scope_values),
    accessSecretHandle: requireStoredSecretHandle(row.access_secret_handle),
    refreshSecretHandle:
      row.refresh_secret_handle === null
        ? null
        : requireStoredSecretHandle(row.refresh_secret_handle),
    tokenExpiresAt: expiresAt,
    selectedCalendarIdentifier: requireBoundedStoredText(
      row.selected_calendar_identifier,
      MAXIMUM_CALENDAR_IDENTIFIER_LENGTH,
    ),
    status,
    createdAt,
    updatedAt,
    revokedAt,
  });
}

function oneOrUndefined<Row>(rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) {
    return invalidPersistence();
  }
  return rows[0];
}

function validateCreateInput(
  input: CreateCalendarConnection,
): CreateCalendarConnection {
  const createdAt = requireInputInstant(input.createdAt);
  const tokenExpiresAt = requireInputInstant(input.tokenExpiresAt);
  if (new Date(tokenExpiresAt).getTime() <= new Date(createdAt).getTime()) {
    return invalidInput();
  }
  return Object.freeze({
    connectionId: requireInputUuid(input.connectionId),
    workspaceId: requireInputUuid(input.workspaceId),
    userId: requireInputUuid(input.userId),
    providerCode: requireInputProvider(input.providerCode),
    providerAccountSubject: requireBoundedInputText(
      input.providerAccountSubject,
      MAXIMUM_PROVIDER_SUBJECT_LENGTH,
    ),
    scopeValues: normalizeInputScopes(input.scopeValues),
    accessSecretHandle: requireInputSecretHandle(input.accessSecretHandle),
    refreshSecretHandle:
      input.refreshSecretHandle === null
        ? null
        : requireInputSecretHandle(input.refreshSecretHandle),
    tokenExpiresAt,
    selectedCalendarIdentifier: requireBoundedInputText(
      input.selectedCalendarIdentifier,
      MAXIMUM_CALENDAR_IDENTIFIER_LENGTH,
    ),
    createdAt,
  });
}

function validateLookupInput(
  input: GetActiveCalendarConnection,
): GetActiveCalendarConnection {
  return Object.freeze({
    connectionId: requireInputUuid(input.connectionId),
    workspaceId: requireInputUuid(input.workspaceId),
    userId: requireInputUuid(input.userId),
  });
}

/**
 * PostgreSQL-backed registry for tenant/user-scoped calendar connection
 * metadata and opaque external secret handles.
 */
export class PostgresCalendarConnectionRepository {
  /** Creates the registry over a least-authority fixed-query SQL client. */
  constructor(private readonly client: CalendarConnectionSqlClient) {}

  /** Creates one active connection without persisting plaintext credentials. */
  async createConnection(
    input: CreateCalendarConnection,
  ): Promise<CalendarConnectionRecord> {
    const safe = validateCreateInput(input);
    const result = await this.client.query<CalendarConnectionRow>(
      `INSERT INTO calendar_integration.calendar_connection_record (
         connection_id,
         workspace_id,
         user_id,
         provider_code,
         provider_account_subject,
         scope_values,
         access_secret_handle,
         refresh_secret_handle,
         token_expires_at,
         selected_calendar_identifier,
         connection_status,
         created_at,
         updated_at
       ) VALUES (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6::text[], $7, $8,
         $9::timestamptz, $10, 'active', $11::timestamptz, $11::timestamptz
       )
       ON CONFLICT (connection_id) DO NOTHING
       RETURNING connection_id, workspace_id, user_id, provider_code,
                 provider_account_subject, scope_values, access_secret_handle,
                 refresh_secret_handle, token_expires_at,
                 selected_calendar_identifier, connection_status, created_at,
                 updated_at, revoked_at`,
      [
        safe.connectionId,
        safe.workspaceId,
        safe.userId,
        safe.providerCode,
        safe.providerAccountSubject,
        safe.scopeValues,
        safe.accessSecretHandle,
        safe.refreshSecretHandle,
        safe.tokenExpiresAt,
        safe.selectedCalendarIdentifier,
        safe.createdAt,
      ],
    );
    const row = oneOrUndefined(result.rows);
    if (!row) {
      throw new CalendarConnectionConflictError();
    }
    const connection = parseStoredConnection(row);
    if (
      connection.connectionId !== safe.connectionId ||
      connection.workspaceId !== safe.workspaceId ||
      connection.userId !== safe.userId ||
      connection.providerCode !== safe.providerCode ||
      connection.providerAccountSubject !== safe.providerAccountSubject ||
      connection.accessSecretHandle !== safe.accessSecretHandle ||
      connection.refreshSecretHandle !== safe.refreshSecretHandle ||
      connection.selectedCalendarIdentifier !== safe.selectedCalendarIdentifier
    ) {
      return invalidPersistence();
    }
    return connection;
  }

  /** Returns an active connection only through tenant/user/connection scope. */
  async getActiveConnection(
    input: GetActiveCalendarConnection,
  ): Promise<CalendarConnectionRecord | undefined> {
    const safe = validateLookupInput(input);
    const result = await this.client.query<CalendarConnectionRow>(
      `SELECT connection_id, workspace_id, user_id, provider_code,
              provider_account_subject, scope_values, access_secret_handle,
              refresh_secret_handle, token_expires_at,
              selected_calendar_identifier, connection_status, created_at,
              updated_at, revoked_at
       FROM calendar_integration.calendar_connection_record
       WHERE connection_id = $1::uuid
         AND workspace_id = $2::uuid
         AND user_id = $3::uuid
         AND connection_status = 'active'
       LIMIT 2`,
      [safe.connectionId, safe.workspaceId, safe.userId],
    );
    const row = oneOrUndefined(result.rows);
    if (!row) {
      return undefined;
    }
    const connection = parseStoredConnection(row);
    if (connection.status !== 'active') {
      return invalidPersistence();
    }
    return connection;
  }
}
