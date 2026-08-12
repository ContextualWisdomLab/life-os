import type { TrustedCalendarUserContext } from './calendar-service-context';
import type {
  CalendarConnectionProvider,
  CalendarConnectionRecord,
  CreateCalendarConnection,
} from './calendar-connection-repository';

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
const MAXIMUM_SECRET_LENGTH = 16_384;
const MAXIMUM_CALENDAR_IDENTIFIER_LENGTH = 1024;

/** Provider authorization result accepted only after trusted LifeOS user authentication. */
export interface CalendarConnectionProviderAuthorization {
  readonly connectionId: string;
  readonly providerCode: CalendarConnectionProvider;
  readonly providerAccountSubject: string;
  readonly scopeValues: readonly string[];
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly tokenExpiresAt: string;
  readonly selectedCalendarIdentifier: string;
}

/** Secret write input whose ownership is derived exclusively from trusted LifeOS authority. */
export interface CalendarConnectionCredentialWrite {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly credentialKind: 'access' | 'refresh';
  readonly secretValue: string;
}

/** Least-authority encrypted secret-store/KMS boundary required by connection creation. */
export interface CalendarConnectionCredentialStore {
  writeSecret(input: CalendarConnectionCredentialWrite): Promise<string>;
  deleteSecret(secretHandle: string): Promise<void>;
}

/** Calendar-owned persistence boundary required to create durable connection metadata. */
export interface CalendarConnectionCreateRepository {
  createConnection(input: CreateCalendarConnection): Promise<CalendarConnectionRecord>;
}

/** Credential-free result safe to return to the authenticated connection owner. */
export interface CalendarConnectionCreateResult {
  readonly connectionId: string;
  readonly providerCode: CalendarConnectionProvider;
  readonly scopeValues: readonly string[];
  readonly tokenExpiresAt: string;
  readonly selectedCalendarIdentifier: string;
  readonly status: 'active';
}

/** Rejects malformed provider authorization data before secrets or metadata are written. */
export class CalendarConnectionCreateValidationError extends Error {
  /** Creates a fixed validation failure without retaining provider credential material. */
  constructor() {
    super('Calendar connection creation input is invalid');
    this.name = 'CalendarConnectionCreateValidationError';
  }
}

/** Fail-closed dependency/provisioning error that never retains credential material. */
export class CalendarConnectionCreateDependencyError extends Error {
  /** Creates a fixed dependency failure safe for application-level sanitization. */
  constructor() {
    super('Calendar connection creation is unavailable');
    this.name = 'CalendarConnectionCreateDependencyError';
  }
}

function invalid(): never {
  throw new CalendarConnectionCreateValidationError();
}

function unavailable(): never {
  throw new CalendarConnectionCreateDependencyError();
}

function requireUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

function requireProvider(value: unknown): CalendarConnectionProvider {
  if (value !== 'google' && value !== 'caldav') {
    return invalid();
  }
  return value;
}

function requireText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

function requireSecret(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_SECRET_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

function requireSecretHandle(value: unknown): string {
  if (typeof value !== 'string' || !SECRET_HANDLE_PATTERN.test(value)) {
    return unavailable();
  }
  return value;
}

function requireInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalid();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    return invalid();
  }
  return value;
}

function requireScopes(value: unknown): readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAXIMUM_SCOPE_COUNT
  ) {
    return invalid();
  }
  const scopes = value.map((scope) => requireText(scope, MAXIMUM_SCOPE_LENGTH));
  const canonical = [...new Set(scopes)].sort();
  if (canonical.length === 0 || canonical.length !== scopes.length) {
    return invalid();
  }
  return Object.freeze(canonical);
}

function normalizeAuthorization(
  authority: TrustedCalendarUserContext,
  input: CalendarConnectionProviderAuthorization,
  now: () => string,
): {
  readonly connectionId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly providerCode: CalendarConnectionProvider;
  readonly providerAccountSubject: string;
  readonly scopeValues: readonly string[];
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly tokenExpiresAt: string;
  readonly selectedCalendarIdentifier: string;
  readonly createdAt: string;
} {
  if (!input || typeof input !== 'object') {
    return invalid();
  }
  const createdAt = requireInstant(now());
  const tokenExpiresAt = requireInstant(input.tokenExpiresAt);
  if (new Date(tokenExpiresAt).getTime() <= new Date(createdAt).getTime()) {
    return invalid();
  }
  return Object.freeze({
    connectionId: requireUuid(input.connectionId),
    workspaceId: requireUuid(authority.workspaceId),
    userId: requireUuid(authority.userId),
    providerCode: requireProvider(input.providerCode),
    providerAccountSubject: requireText(
      input.providerAccountSubject,
      MAXIMUM_PROVIDER_SUBJECT_LENGTH,
    ),
    scopeValues: requireScopes(input.scopeValues),
    accessToken: requireSecret(input.accessToken),
    refreshToken:
      input.refreshToken === null ? null : requireSecret(input.refreshToken),
    tokenExpiresAt,
    selectedCalendarIdentifier: requireText(
      input.selectedCalendarIdentifier,
      MAXIMUM_CALENDAR_IDENTIFIER_LENGTH,
    ),
    createdAt,
  });
}

async function bestEffortCleanup(
  store: CalendarConnectionCredentialStore,
  handles: readonly string[],
): Promise<void> {
  const cleanup = await Promise.allSettled(
    [...handles].reverse().map(async (handle) => await store.deleteSecret(handle)),
  );
  if (cleanup.some((result) => result.status === 'rejected')) {
    return unavailable();
  }
}

function projectCreated(
  record: CalendarConnectionRecord,
  expected: {
    readonly connectionId: string;
    readonly workspaceId: string;
    readonly userId: string;
    readonly providerCode: CalendarConnectionProvider;
    readonly providerAccountSubject: string;
    readonly scopeValues: readonly string[];
    readonly tokenExpiresAt: string;
    readonly selectedCalendarIdentifier: string;
    readonly accessSecretHandle: string;
    readonly refreshSecretHandle: string | null;
  },
): CalendarConnectionCreateResult {
  if (
    record.connectionId !== expected.connectionId ||
    record.workspaceId !== expected.workspaceId ||
    record.userId !== expected.userId ||
    record.providerCode !== expected.providerCode ||
    record.providerAccountSubject !== expected.providerAccountSubject ||
    record.status !== 'active' ||
    record.revokedAt !== null ||
    record.accessSecretHandle !== expected.accessSecretHandle ||
    record.refreshSecretHandle !== expected.refreshSecretHandle ||
    record.tokenExpiresAt !== expected.tokenExpiresAt ||
    record.selectedCalendarIdentifier !== expected.selectedCalendarIdentifier ||
    record.scopeValues.length !== expected.scopeValues.length ||
    record.scopeValues.some((scope, index) => scope !== expected.scopeValues[index])
  ) {
    return unavailable();
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

/**
 * Creates one user-owned calendar connection without accepting tenant ownership
 * or secret handles from provider/browser input.
 */
export class CalendarConnectionCreateApplication {
  /** Creates the boundary over Calendar-owned metadata and encrypted credential storage. */
  constructor(
    private readonly connections: CalendarConnectionCreateRepository,
    private readonly credentials: CalendarConnectionCredentialStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /**
   * Stores provider credentials first, persists only opaque handles, and
   * compensates newly written credentials if durable metadata creation or
   * returned persistence evidence fails validation.
   */
  async create(
    authority: TrustedCalendarUserContext,
    untrustedInput: CalendarConnectionProviderAuthorization,
  ): Promise<CalendarConnectionCreateResult> {
    const safe = normalizeAuthorization(authority, untrustedInput, this.now);
    const writtenHandles: string[] = [];
    let accessSecretHandle: string;
    let refreshSecretHandle: string | null = null;

    try {
      accessSecretHandle = requireSecretHandle(
        await this.credentials.writeSecret({
          connectionId: safe.connectionId,
          workspaceId: safe.workspaceId,
          userId: safe.userId,
          credentialKind: 'access',
          secretValue: safe.accessToken,
        }),
      );
      writtenHandles.push(accessSecretHandle);

      if (safe.refreshToken !== null) {
        refreshSecretHandle = requireSecretHandle(
          await this.credentials.writeSecret({
            connectionId: safe.connectionId,
            workspaceId: safe.workspaceId,
            userId: safe.userId,
            credentialKind: 'refresh',
            secretValue: safe.refreshToken,
          }),
        );
        writtenHandles.push(refreshSecretHandle);
      }
    } catch {
      if (writtenHandles.length > 0) {
        await bestEffortCleanup(this.credentials, writtenHandles);
      }
      return unavailable();
    }

    let record: CalendarConnectionRecord;
    try {
      const persistenceInput: CreateCalendarConnection = Object.freeze({
        connectionId: safe.connectionId,
        workspaceId: safe.workspaceId,
        userId: safe.userId,
        providerCode: safe.providerCode,
        providerAccountSubject: safe.providerAccountSubject,
        scopeValues: safe.scopeValues,
        accessSecretHandle,
        refreshSecretHandle,
        tokenExpiresAt: safe.tokenExpiresAt,
        selectedCalendarIdentifier: safe.selectedCalendarIdentifier,
        createdAt: safe.createdAt,
      });
      record = await this.connections.createConnection(persistenceInput);
    } catch {
      await bestEffortCleanup(this.credentials, writtenHandles);
      return unavailable();
    }

    try {
      return projectCreated(record, {
        connectionId: safe.connectionId,
        workspaceId: safe.workspaceId,
        userId: safe.userId,
        providerCode: safe.providerCode,
        providerAccountSubject: safe.providerAccountSubject,
        scopeValues: safe.scopeValues,
        tokenExpiresAt: safe.tokenExpiresAt,
        selectedCalendarIdentifier: safe.selectedCalendarIdentifier,
        accessSecretHandle,
        refreshSecretHandle,
      });
    } catch {
      await bestEffortCleanup(this.credentials, writtenHandles);
      return unavailable();
    }
  }
}
