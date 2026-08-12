import type { TrustedCalendarUserContext } from './calendar-service-context';
import type {
  CalendarConnectionProvider,
  CalendarConnectionRecord,
  GetActiveCalendarConnection,
} from './calendar-connection-repository';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SECRET_HANDLE_PATTERN =
  /^[A-Za-z][A-Za-z0-9+.-]{0,31}:\/\/[^\s\u0000-\u001f\u007f]{1,1024}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAXIMUM_SECRET_LENGTH = 16_384;

/** Least-authority lookup needed before calendar credential materialization. */
export interface CalendarCredentialConnectionPort {
  getActiveConnection(
    input: GetActiveCalendarConnection,
  ): Promise<CalendarConnectionRecord | undefined>;
}

/** External encrypted secret-store/KMS port; opaque handles are the only lookup key. */
export interface CalendarCredentialSecretStore {
  readSecret(secretHandle: string): Promise<string>;
}

/** Internal-only provider material. This type must never be returned by a public controller. */
export interface CalendarCredentialMaterial {
  readonly connectionId: string;
  readonly providerCode: CalendarConnectionProvider;
  readonly accessToken: string;
  readonly refreshToken: string | null;
  readonly tokenExpiresAt: string;
  readonly selectedCalendarIdentifier: string;
}

/** Fixed fail-closed error that never retains provider credential material. */
export class CalendarCredentialMaterializationError extends Error {
  /** Creates a credential-free failure safe for application-level sanitization. */
  constructor() {
    super('Calendar credential materialization is unavailable');
    this.name = 'CalendarCredentialMaterializationError';
  }
}

function invalid(): never {
  throw new CalendarCredentialMaterializationError();
}

function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalid();
  }
  return value.toLowerCase();
}

function requireSecretHandle(value: unknown): string {
  if (typeof value !== 'string' || !SECRET_HANDLE_PATTERN.test(value)) {
    return invalid();
  }
  return value;
}

function requireSecretMaterial(value: unknown): string {
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

function requireActiveEvidence(
  record: CalendarConnectionRecord,
  expected: GetActiveCalendarConnection,
): CalendarConnectionRecord {
  if (
    record.status !== 'active' ||
    record.revokedAt !== null ||
    record.connectionId !== expected.connectionId ||
    record.workspaceId !== expected.workspaceId ||
    record.userId !== expected.userId
  ) {
    return invalid();
  }
  return record;
}

/**
 * Resolves provider credentials only after exact tenant/user/connection authority.
 * Durable LifeOS state supplies opaque handles; plaintext exists only in the
 * returned internal value and must be passed directly to the selected provider.
 */
export class CalendarCredentialMaterializer {
  /** Creates the materializer over scoped connection evidence and encrypted secret storage. */
  constructor(
    private readonly connections: CalendarCredentialConnectionPort,
    private readonly secrets: CalendarCredentialSecretStore,
  ) {}

  /** Materializes one exact active connection without accepting ownership from caller data. */
  async materialize(
    authority: TrustedCalendarUserContext,
    connectionId: string,
  ): Promise<CalendarCredentialMaterial> {
    const expected = Object.freeze({
      connectionId: requireUuidV4(connectionId),
      workspaceId: requireUuidV4(authority.workspaceId),
      userId: requireUuidV4(authority.userId),
    });

    let persisted: CalendarConnectionRecord | undefined;
    try {
      persisted = await this.connections.getActiveConnection(expected);
    } catch {
      return invalid();
    }
    if (!persisted) {
      return invalid();
    }
    const record = requireActiveEvidence(persisted, expected);
    const accessSecretHandle = requireSecretHandle(record.accessSecretHandle);
    const refreshSecretHandle =
      record.refreshSecretHandle === null
        ? null
        : requireSecretHandle(record.refreshSecretHandle);

    let accessToken: string;
    let refreshToken: string | null;
    try {
      accessToken = requireSecretMaterial(
        await this.secrets.readSecret(accessSecretHandle),
      );
      refreshToken = refreshSecretHandle
        ? requireSecretMaterial(await this.secrets.readSecret(refreshSecretHandle))
        : null;
    } catch {
      return invalid();
    }

    return Object.freeze({
      connectionId: record.connectionId,
      providerCode: record.providerCode,
      accessToken,
      refreshToken,
      tokenExpiresAt: record.tokenExpiresAt,
      selectedCalendarIdentifier: record.selectedCalendarIdentifier,
    });
  }
}
