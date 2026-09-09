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

/** Raw credential-binding row before durable scope, lifecycle, and secret-reference validation. */
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

/** Terminates malformed credential commands before SQL authority is exercised. */
function invalidInput(): never {
  throw new PluginCredentialPersistenceValidationError();
}

/** Terminates ambiguous or corrupt durable credential evidence without reflecting backend detail. */
function invalidEvidence(): never {
  throw new PluginCredentialPersistenceEvidenceError();
}

/** Collapses hostile synchronous command reads into the fixed persistence-input failure. */
function boundedInputRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalidInput();
  }
}

/** Collapses hostile synchronous durable-evidence reads into the fixed persistence-evidence failure. */
function boundedEvidenceRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalidEvidence();
  }
}

/** Collapses SQL rejection or hostile Promise assimilation into fixed persistence evidence failure. */
async function boundedEvidenceDependency<T>(
  read: () => Promise<T>,
): Promise<{ readonly value: T }> {
  try {
    const value = await read();
    return { value };
  } catch {
    return invalidEvidence();
  }
}

/** Canonicalizes an input UUIDv4 before it can become a SQL parameter. */
function inputUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidInput();
  }
  return value.toLowerCase();
}

/** Requires stored UUIDv4 evidence to already be canonical lowercase. */
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

/** Requires one exact input-side millisecond UTC instant before persistence access. */
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

/** Canonicalizes PostgreSQL Date/string timestamps into exact durable lifecycle evidence. */
function storedInstant(value: unknown): string {
  const isDate = boundedEvidenceRead(() => value instanceof Date);
  let candidate: string;
  if (isDate) {
    const date = value as Date;
    const [milliseconds, serialized] = boundedEvidenceRead(
      () => [date.getTime(), date.toISOString()] as const,
    );
    if (!Number.isFinite(milliseconds)) {
      return invalidEvidence();
    }
    candidate = serialized;
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

/** Restricts input credential names to the host-owned stable identifier grammar. */
function inputCredentialName(value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_NAME_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

/** Requires stored credential-name evidence to satisfy the same stable identifier grammar. */
function storedCredentialName(value: unknown): string {
  if (typeof value !== 'string' || !CREDENTIAL_NAME_PATTERN.test(value)) {
    return invalidEvidence();
  }
  return value;
}

/** Bounds opaque input secret references and rejects control/space characters before SQL. */
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

/** Revalidates opaque stored secret references without dereferencing secret material. */
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

/**
 * Accepts only an internally consistent zero-or-one-row SQL result. Exact zero-row
 * results map to `undefined`; malformed envelopes, mismatched row counts, and a
 * declared row without row evidence are corrupted persistence evidence.
 */
function oneOrUndefined<Row>(
  result: PluginCredentialSqlResult<Row>,
): Row | undefined {
  if (result === null || typeof result !== 'object') {
    return invalidEvidence();
  }
  if (boundedEvidenceRead(() => Array.isArray(result))) {
    return invalidEvidence();
  }
  const [rows, rowCount] = boundedEvidenceRead(
    () => [result.rows, result.rowCount] as const,
  );
  if (!boundedEvidenceRead(() => Array.isArray(rows))) {
    return invalidEvidence();
  }
  const rowsLength = boundedEvidenceRead(() => rows.length);
  if (
    typeof rowCount !== 'number' ||
    !Number.isInteger(rowCount) ||
    rowCount < 0 ||
    rowCount !== rowsLength ||
    rowsLength > 1
  ) {
    return invalidEvidence();
  }
  if (rowsLength === 0) {
    return undefined;
  }
  const row = boundedEvidenceRead(() => rows[0]);
  return row === undefined ? invalidEvidence() : row;
}

/** Validates active create metadata before it can become durable credential authority. */
function validateCreate(
  record: PluginCredentialBindingRecord,
): PluginCredentialBindingRecord {
  if (record === null || typeof record !== 'object') {
    return invalidInput();
  }
  if (boundedInputRead(() => Array.isArray(record))) {
    return invalidInput();
  }
  const snapshot = boundedInputRead(() => ({
    credentialBindingId: record.credentialBindingId,
    installationId: record.installationId,
    workspaceId: record.workspaceId,
    installedByUserId: record.installedByUserId,
    credentialName: record.credentialName,
    secretReference: record.secretReference,
    status: record.status,
    boundAt: record.boundAt,
    revokedAt: record.revokedAt,
  }));
  if (snapshot.status !== 'active' || snapshot.revokedAt !== null) {
    return invalidInput();
  }
  return Object.freeze({
    credentialBindingId: inputUuid(snapshot.credentialBindingId),
    installationId: inputUuid(snapshot.installationId),
    workspaceId: inputUuid(snapshot.workspaceId),
    installedByUserId: inputUuid(snapshot.installedByUserId),
    credentialName: inputCredentialName(snapshot.credentialName),
    secretReference: inputSecretReference(snapshot.secretReference),
    status: 'active',
    boundAt: inputInstant(snapshot.boundAt),
    revokedAt: null,
  });
}

/** Validates exact scoped revocation identity and time before issuing the conditional UPDATE. */
function validateRevocation(input: RevokePluginCredential): RevokePluginCredential {
  if (input === null || typeof input !== 'object') {
    return invalidInput();
  }
  if (boundedInputRead(() => Array.isArray(input))) {
    return invalidInput();
  }
  const snapshot = boundedInputRead(() => ({
    credentialBindingId: input.credentialBindingId,
    workspaceId: input.workspaceId,
    installedByUserId: input.installedByUserId,
    revokedAt: input.revokedAt,
  }));
  return Object.freeze({
    credentialBindingId: inputUuid(snapshot.credentialBindingId),
    workspaceId: inputUuid(snapshot.workspaceId),
    installedByUserId: inputUuid(snapshot.installedByUserId),
    revokedAt: inputInstant(snapshot.revokedAt),
  });
}

/**
 * Converts one returned SQL row into canonical durable binding evidence. Every
 * identity, lifecycle instant, status transition, credential name, and opaque
 * secret reference is validated before the row can become application authority.
 */
function parseRow(row: unknown): PluginCredentialBindingRecord {
  if (row === null || typeof row !== 'object') {
    return invalidEvidence();
  }
  if (boundedEvidenceRead(() => Array.isArray(row))) {
    return invalidEvidence();
  }
  const candidate = row as PluginCredentialRow;
  const snapshot = boundedEvidenceRead(() => ({
    credentialBindingId: candidate.credential_binding_id,
    installationId: candidate.installation_id,
    workspaceId: candidate.workspace_id,
    installedByUserId: candidate.installed_by_user_id,
    credentialName: candidate.credential_name,
    secretReference: candidate.secret_reference,
    status: candidate.credential_status,
    boundAt: candidate.bound_at,
    revokedAt: candidate.revoked_at,
  }));
  const status =
    snapshot.status === 'active' || snapshot.status === 'revoked'
      ? snapshot.status
      : invalidEvidence();
  const boundAt = storedInstant(snapshot.boundAt);
  const revokedAt =
    snapshot.revokedAt === null ? null : storedInstant(snapshot.revokedAt);
  if (
    (status === 'active' && revokedAt !== null) ||
    (status === 'revoked' && revokedAt === null) ||
    (revokedAt !== null &&
      new Date(revokedAt).getTime() < new Date(boundAt).getTime())
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    credentialBindingId: storedUuid(snapshot.credentialBindingId),
    installationId: storedUuid(snapshot.installationId),
    workspaceId: storedUuid(snapshot.workspaceId),
    installedByUserId: storedUuid(snapshot.installedByUserId),
    credentialName: storedCredentialName(snapshot.credentialName),
    secretReference: storedSecretReference(snapshot.secretReference),
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
    const inserted = (
      await boundedEvidenceDependency(() =>
        this.client.query<PluginCredentialRow>(
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
        ),
      )
    ).value;
    let row = oneOrUndefined(inserted);
    if (row === undefined) {
      const existing = (
        await boundedEvidenceDependency(() =>
          this.client.query<PluginCredentialRow>(
            `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_credential_binding_record
         WHERE credential_binding_id = $1::uuid
           AND workspace_id = $2::uuid
           AND installed_by_user_id = $3::uuid
         LIMIT 2`,
            [safe.credentialBindingId, safe.workspaceId, safe.installedByUserId],
          ),
        )
      ).value;
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
    const result = (
      await boundedEvidenceDependency(() =>
        this.client.query<PluginCredentialRow>(
          `SELECT ${RETURNING_COLUMNS}
       FROM plugin_integration.plugin_credential_binding_record
       WHERE credential_binding_id = $1::uuid
         AND workspace_id = $2::uuid
         AND installed_by_user_id = $3::uuid
       LIMIT 2`,
          [credentialBindingId, workspaceId, installedByUserId],
        ),
      )
    ).value;
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
    const updated = (
      await boundedEvidenceDependency(() =>
        this.client.query<PluginCredentialRow>(
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
        ),
      )
    ).value;
    let row = oneOrUndefined(updated);
    if (row === undefined) {
      const replay = (
        await boundedEvidenceDependency(() =>
          this.client.query<PluginCredentialRow>(
            `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_credential_binding_record
         WHERE credential_binding_id = $1::uuid
           AND workspace_id = $2::uuid
           AND installed_by_user_id = $3::uuid
           AND credential_status = 'revoked'
         LIMIT 2`,
            [safe.credentialBindingId, safe.workspaceId, safe.installedByUserId],
          ),
        )
      ).value;
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
