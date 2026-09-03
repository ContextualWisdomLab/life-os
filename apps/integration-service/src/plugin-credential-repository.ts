import type {
  PluginCredentialBindingRecord,
  PluginCredentialBindingStore,
  RevokePluginCredential,
} from './plugin-credential';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CREDENTIAL_NAME_PATTERN = /^[a-z][a-z0-9._-]{0,127}$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONTROL_OR_SPACE_PATTERN = /[\u0000-\u0020\u007f]/u;
const MAXIMUM_SECRET_REFERENCE_LENGTH = 512;

/** Result returned by the bounded credential SQL client. */
export interface PluginCredentialSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal fixed-query SQL authority used by the PostgreSQL credential store. */
export interface PluginCredentialSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginCredentialSqlResult<Row>>;
}

/** Rejects malformed credential persistence input before PostgreSQL. */
export class PluginCredentialPersistenceValidationError extends Error {
  /** Creates a fixed credential-free validation failure. */
  constructor() {
    super('Plugin credential persistence input is invalid');
    this.name = 'PluginCredentialPersistenceValidationError';
  }
}

/** Rejects ambiguous or corrupted durable credential evidence. */
export class PluginCredentialPersistenceEvidenceError extends Error {
  /** Creates a fixed failure without reflecting untrusted database values. */
  constructor() {
    super('Persisted plugin credential evidence is invalid');
    this.name = 'PluginCredentialPersistenceEvidenceError';
  }
}

interface PluginCredentialRow {
  credential_binding_id: unknown;
  installation_id: unknown;
  workspace_id: unknown;
  installed_by_user_id: unknown;
  credential_name: unknown;
  secret_reference: unknown;
  credential_status: unknown;
  bound_at: unknown;
  revoked_at: unknown;
}

function invalidInput(): never {
  throw new PluginCredentialPersistenceValidationError();
}

function invalidEvidence(): never {
  throw new PluginCredentialPersistenceEvidenceError();
}

function inputUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidInput();
  }
  return value.toLowerCase();
}

function storedUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidEvidence();
  }
  const canonical = value.toLowerCase();
  if (value !== canonical) {
    return invalidEvidence();
  }
  return canonical;
}

function inputInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalidInput();
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    return invalidInput();
  }
  return value;
}

function storedInstant(value: unknown): string {
  let candidate: string;
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      return invalidEvidence();
    }
    candidate = value.toISOString();
  } else if (typeof value === 'string') {
    candidate = value;
  } else {
    return invalidEvidence();
  }
  if (!ISO_INSTANT_PATTERN.test(candidate)) {
    return invalidEvidence();
  }
  const date = new Date(candidate);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== candidate) {
    return invalidEvidence();
  }
  return candidate;
}

function inputCredentialName(value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_NAME_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

function storedCredentialName(value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_NAME_PATTERN.test(value)) {
    return invalidEvidence();
  }
  return value;
}

function inputSecretReference(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > MAXIMUM_SECRET_REFERENCE_LENGTH ||
    CONTROL_OR_SPACE_PATTERN.test(value)
  ) {
    return invalidInput();
  }
  return value;
}

function storedSecretReference(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > MAXIMUM_SECRET_REFERENCE_LENGTH ||
    CONTROL_OR_SPACE_PATTERN.test(value)
  ) {
    return invalidEvidence();
  }
  return value;
}

function oneOrUndefined<Row>(
  result: PluginCredentialSqlResult<Row>,
): Row | undefined {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return invalidEvidence();
  }
  const rows = result.rows;
  const rowCount = result.rowCount;
  if (
    !Array.isArray(rows) ||
    typeof rowCount !== 'number' ||
    !Number.isInteger(rowCount) ||
    rowCount < 0 ||
    rowCount !== rows.length ||
    rows.length > 1
  ) {
    return invalidEvidence();
  }
  if (rows.length === 1 && rows[0] === undefined) {
    return invalidEvidence();
  }
  return rows[0];
}

function validateCreate(
  record: PluginCredentialBindingRecord,
): PluginCredentialBindingRecord {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return invalidInput();
  }
  if (record.status !== 'active' || record.revokedAt !== null) {
    return invalidInput();
  }
  return Object.freeze({
    credentialBindingId: inputUuid(record.credentialBindingId),
    installationId: inputUuid(record.installationId),
    workspaceId: inputUuid(record.workspaceId),
    installedByUserId: inputUuid(record.installedByUserId),
    credentialName: inputCredentialName(record.credentialName),
    secretReference: inputSecretReference(record.secretReference),
    status: 'active',
    boundAt: inputInstant(record.boundAt),
    revokedAt: null,
  });
}

function validateRevocation(input: RevokePluginCredential): RevokePluginCredential {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalidInput();
  }
  return Object.freeze({
    credentialBindingId: inputUuid(input.credentialBindingId),
    workspaceId: inputUuid(input.workspaceId),
    installedByUserId: inputUuid(input.installedByUserId),
    revokedAt: inputInstant(input.revokedAt),
  });
}

function parseRow(row: unknown): PluginCredentialBindingRecord {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return invalidEvidence();
  }
  const candidate = row as PluginCredentialRow;
  const status =
    candidate.credential_status === 'active' ||
    candidate.credential_status === 'revoked'
      ? candidate.credential_status
      : invalidEvidence();
  const boundAt = storedInstant(candidate.bound_at);
  const revokedAt =
    candidate.revoked_at === null ? null : storedInstant(candidate.revoked_at);
  if (
    (status === 'active' && revokedAt !== null) ||
    (status === 'revoked' && revokedAt === null) ||
    (revokedAt !== null &&
      new Date(revokedAt).getTime() < new Date(boundAt).getTime())
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    credentialBindingId: storedUuid(candidate.credential_binding_id),
    installationId: storedUuid(candidate.installation_id),
    workspaceId: storedUuid(candidate.workspace_id),
    installedByUserId: storedUuid(candidate.installed_by_user_id),
    credentialName: storedCredentialName(candidate.credential_name),
    secretReference: storedSecretReference(candidate.secret_reference),
    status,
    boundAt,
    revokedAt,
  });
}

const RETURNING_COLUMNS = `credential_binding_id, installation_id, workspace_id,
         installed_by_user_id, credential_name, secret_reference,
         credential_status, bound_at, revoked_at`;

/** PostgreSQL implementation of durable plugin credential metadata storage. */
export class PostgresPluginCredentialBindingStore
  implements PluginCredentialBindingStore
{
  /** Creates the store over a bounded parameterized SQL client. */
  constructor(private readonly client: PluginCredentialSqlClient) {}

  /** Creates active metadata or returns the scoped durable replay winner. */
  async createIfAbsent(
    record: PluginCredentialBindingRecord,
  ): Promise<PluginCredentialBindingRecord> {
    const safe = validateCreate(record);
    const inserted = await this.client.query<PluginCredentialRow>(
      `INSERT INTO plugin_integration.plugin_credential_binding_record (
         credential_binding_id, installation_id, workspace_id,
         installed_by_user_id, credential_name, secret_reference,
         credential_status, bound_at
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 'active', $7::timestamptz)
       ON CONFLICT (credential_binding_id) DO NOTHING
       RETURNING ${RETURNING_COLUMNS}`,
      [
        safe.credentialBindingId,
        safe.installationId,
        safe.workspaceId,
        safe.installedByUserId,
        safe.credentialName,
        safe.secretReference,
        safe.boundAt,
      ],
    );
    let row = oneOrUndefined(inserted);
    if (row === undefined) {
      const existing = await this.client.query<PluginCredentialRow>(
        `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_credential_binding_record
         WHERE credential_binding_id = $1::uuid
           AND workspace_id = $2::uuid
           AND installed_by_user_id = $3::uuid
         LIMIT 2`,
        [safe.credentialBindingId, safe.workspaceId, safe.installedByUserId],
      );
      row = oneOrUndefined(existing);
    }
    if (row === undefined) {
      return invalidEvidence();
    }
    return parseRow(row);
  }

  /** Reads one credential binding only inside exact workspace-and-user authority. */
  async findById(
    credentialBindingIdInput: string,
    workspaceIdInput: string,
    installedByUserIdInput: string,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    const credentialBindingId = inputUuid(credentialBindingIdInput);
    const workspaceId = inputUuid(workspaceIdInput);
    const installedByUserId = inputUuid(installedByUserIdInput);
    const result = await this.client.query<PluginCredentialRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM plugin_integration.plugin_credential_binding_record
       WHERE credential_binding_id = $1::uuid
         AND workspace_id = $2::uuid
         AND installed_by_user_id = $3::uuid
       LIMIT 2`,
      [credentialBindingId, workspaceId, installedByUserId],
    );
    const row = oneOrUndefined(result);
    if (row === undefined) {
      return undefined;
    }
    const durable = parseRow(row);
    if (
      durable.credentialBindingId !== credentialBindingId ||
      durable.workspaceId !== workspaceId ||
      durable.installedByUserId !== installedByUserId
    ) {
      return invalidEvidence();
    }
    return durable;
  }

  /** Atomically revokes scoped active metadata or returns the durable replay. */
  async revokeActive(
    input: RevokePluginCredential,
  ): Promise<PluginCredentialBindingRecord | undefined> {
    const safe = validateRevocation(input);
    const updated = await this.client.query<PluginCredentialRow>(
      `UPDATE plugin_integration.plugin_credential_binding_record
       SET credential_status = 'revoked',
           revoked_at = $4::timestamptz
       WHERE credential_binding_id = $1::uuid
         AND workspace_id = $2::uuid
         AND installed_by_user_id = $3::uuid
         AND credential_status = 'active'
         AND bound_at <= $4::timestamptz
       RETURNING ${RETURNING_COLUMNS}`,
      [
        safe.credentialBindingId,
        safe.workspaceId,
        safe.installedByUserId,
        safe.revokedAt,
      ],
    );
    let row = oneOrUndefined(updated);
    if (row === undefined) {
      const replay = await this.client.query<PluginCredentialRow>(
        `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_credential_binding_record
         WHERE credential_binding_id = $1::uuid
           AND workspace_id = $2::uuid
           AND installed_by_user_id = $3::uuid
           AND credential_status = 'revoked'
         LIMIT 2`,
        [safe.credentialBindingId, safe.workspaceId, safe.installedByUserId],
      );
      row = oneOrUndefined(replay);
    }
    if (row === undefined) {
      return undefined;
    }
    const durable = parseRow(row);
    if (
      durable.credentialBindingId !== safe.credentialBindingId ||
      durable.workspaceId !== safe.workspaceId ||
      durable.installedByUserId !== safe.installedByUserId ||
      durable.status !== 'revoked'
    ) {
      return invalidEvidence();
    }
    return durable;
  }
}
