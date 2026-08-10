import type {
  PluginInstallationRecord,
  PluginInstallationStore,
  RevokePluginInstallation,
} from './plugin-installation';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const MAXIMUM_PLUGIN_ID_LENGTH = 256;
const MAXIMUM_CONTRACT_VERSION_LENGTH = 128;
const MAXIMUM_CAPABILITY_COUNT = 32;
const MAXIMUM_CAPABILITY_LENGTH = 256;

/** Result returned by the bounded installation SQL client. */
export interface PluginInstallationSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal fixed-query SQL authority used by the PostgreSQL installation store. */
export interface PluginInstallationSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginInstallationSqlResult<Row>>;
}

/** Rejects malformed input before it reaches PostgreSQL. */
export class PluginInstallationPersistenceValidationError extends Error {
  /** Creates a fixed credential-free validation failure. */
  constructor() {
    super('Plugin installation persistence input is invalid');
    this.name = 'PluginInstallationPersistenceValidationError';
  }
}

/** Rejects impossible, ambiguous, or corrupted persisted installation evidence. */
export class PluginInstallationPersistenceEvidenceError extends Error {
  /** Creates a fixed error without reflecting untrusted database values. */
  constructor() {
    super('Persisted plugin installation evidence is invalid');
    this.name = 'PluginInstallationPersistenceEvidenceError';
  }
}

interface PluginInstallationRow {
  installation_id: unknown;
  workspace_id: unknown;
  installed_by_user_id: unknown;
  plugin_id: unknown;
  plugin_contract_version: unknown;
  manifest_sha256: unknown;
  granted_capabilities: unknown;
  installation_status: unknown;
  installed_at: unknown;
  revoked_at: unknown;
}

function invalidInput(): never {
  throw new PluginInstallationPersistenceValidationError();
}

function invalidEvidence(): never {
  throw new PluginInstallationPersistenceEvidenceError();
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

function boundedInputText(value: unknown, maximumLength: number): string {
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

function boundedStoredText(value: unknown, maximumLength: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    return invalidEvidence();
  }
  return value;
}

function inputDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

function storedDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalidEvidence();
  }
  return value;
}

function inputCapabilities(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_CAPABILITY_COUNT) {
    return invalidInput();
  }
  const items = value.map((item) =>
    boundedInputText(item, MAXIMUM_CAPABILITY_LENGTH),
  );
  const normalized = [...new Set(items)].sort();
  if (
    normalized.length !== items.length ||
    normalized.some((item, index) => item !== items[index])
  ) {
    return invalidInput();
  }
  return Object.freeze(normalized);
}

function storedCapabilities(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_CAPABILITY_COUNT) {
    return invalidEvidence();
  }
  const items = value.map((item) =>
    boundedStoredText(item, MAXIMUM_CAPABILITY_LENGTH),
  );
  const normalized = [...new Set(items)].sort();
  if (
    normalized.length !== items.length ||
    normalized.some((item, index) => item !== items[index])
  ) {
    return invalidEvidence();
  }
  return Object.freeze(normalized);
}

function oneOrUndefined<Row>(rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) {
    return invalidEvidence();
  }
  return rows[0];
}

function validateCreate(record: PluginInstallationRecord): PluginInstallationRecord {
  if (record.status !== 'active' || record.revokedAt !== null) {
    return invalidInput();
  }
  return Object.freeze({
    installationId: inputUuid(record.installationId),
    workspaceId: inputUuid(record.workspaceId),
    installedByUserId: inputUuid(record.installedByUserId),
    pluginId: boundedInputText(record.pluginId, MAXIMUM_PLUGIN_ID_LENGTH),
    pluginContractVersion: boundedInputText(
      record.pluginContractVersion,
      MAXIMUM_CONTRACT_VERSION_LENGTH,
    ),
    manifestSha256: inputDigest(record.manifestSha256),
    grantedCapabilities: inputCapabilities(record.grantedCapabilities),
    status: 'active',
    installedAt: parseInstant(record.installedAt, invalidInput),
    revokedAt: null,
  });
}

function validateRevocation(
  input: RevokePluginInstallation,
): RevokePluginInstallation {
  return Object.freeze({
    installationId: inputUuid(input.installationId),
    workspaceId: inputUuid(input.workspaceId),
    revokedAt: parseInstant(input.revokedAt, invalidInput),
  });
}

function parseRow(row: PluginInstallationRow): PluginInstallationRecord {
  const status =
    row.installation_status === 'active' || row.installation_status === 'revoked'
      ? row.installation_status
      : invalidEvidence();
  const installedAt = parseInstant(row.installed_at, invalidEvidence);
  const revokedAt =
    row.revoked_at === null
      ? null
      : parseInstant(row.revoked_at, invalidEvidence);
  if (
    (status === 'active' && revokedAt !== null) ||
    (status === 'revoked' && revokedAt === null) ||
    (revokedAt !== null &&
      new Date(revokedAt).getTime() < new Date(installedAt).getTime())
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    installationId: storedUuid(row.installation_id),
    workspaceId: storedUuid(row.workspace_id),
    installedByUserId: storedUuid(row.installed_by_user_id),
    pluginId: boundedStoredText(row.plugin_id, MAXIMUM_PLUGIN_ID_LENGTH),
    pluginContractVersion: boundedStoredText(
      row.plugin_contract_version,
      MAXIMUM_CONTRACT_VERSION_LENGTH,
    ),
    manifestSha256: storedDigest(row.manifest_sha256),
    grantedCapabilities: storedCapabilities(row.granted_capabilities),
    status,
    installedAt,
    revokedAt,
  });
}

function exactCandidate(
  actual: PluginInstallationRecord,
  expected: PluginInstallationRecord,
): boolean {
  return (
    actual.installationId === expected.installationId &&
    actual.workspaceId === expected.workspaceId &&
    actual.installedByUserId === expected.installedByUserId &&
    actual.pluginId === expected.pluginId &&
    actual.pluginContractVersion === expected.pluginContractVersion &&
    actual.manifestSha256 === expected.manifestSha256 &&
    actual.status === 'active' &&
    actual.revokedAt === null &&
    actual.grantedCapabilities.length === expected.grantedCapabilities.length &&
    actual.grantedCapabilities.every(
      (capability, index) => capability === expected.grantedCapabilities[index],
    )
  );
}

const RETURNING_COLUMNS = `installation_id, workspace_id, installed_by_user_id,
         plugin_id, plugin_contract_version, manifest_sha256,
         granted_capabilities, installation_status, installed_at, revoked_at`;

/** PostgreSQL implementation of the host-owned plugin installation store. */
export class PostgresPluginInstallationStore implements PluginInstallationStore {
  /** Creates the store over a bounded parameterized SQL client. */
  constructor(private readonly client: PluginInstallationSqlClient) {}

  /** Creates an active installation or returns the exact durable replay winner. */
  async createIfAbsent(
    record: PluginInstallationRecord,
  ): Promise<PluginInstallationRecord> {
    const safe = validateCreate(record);
    const inserted = await this.client.query<PluginInstallationRow>(
      `INSERT INTO plugin_integration.plugin_installation_record (
         installation_id, workspace_id, installed_by_user_id, plugin_id,
         plugin_contract_version, manifest_sha256, granted_capabilities,
         installation_status, installed_at
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::text[], 'active', $8::timestamptz)
       ON CONFLICT (installation_id) DO NOTHING
       RETURNING ${RETURNING_COLUMNS}`,
      [
        safe.installationId,
        safe.workspaceId,
        safe.installedByUserId,
        safe.pluginId,
        safe.pluginContractVersion,
        safe.manifestSha256,
        safe.grantedCapabilities,
        safe.installedAt,
      ],
    );
    let row = oneOrUndefined(inserted.rows);
    if (!row) {
      const existing = await this.client.query<PluginInstallationRow>(
        `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_installation_record
         WHERE installation_id = $1::uuid
           AND workspace_id = $2::uuid
         LIMIT 2`,
        [safe.installationId, safe.workspaceId],
      );
      row = oneOrUndefined(existing.rows);
    }
    if (!row) {
      return invalidEvidence();
    }
    const durable = parseRow(row);
    if (!exactCandidate(durable, safe)) {
      return invalidEvidence();
    }
    return durable;
  }

  /** Reads one installation by opaque identifier for application-level tenant filtering. */
  async findById(
    installationIdInput: string,
  ): Promise<PluginInstallationRecord | undefined> {
    const installationId = inputUuid(installationIdInput);
    const result = await this.client.query<PluginInstallationRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM plugin_integration.plugin_installation_record
       WHERE installation_id = $1::uuid
       LIMIT 2`,
      [installationId],
    );
    const row = oneOrUndefined(result.rows);
    return row ? parseRow(row) : undefined;
  }

  /** Atomically revokes active workspace-owned authority or returns an exact revoked replay. */
  async revokeActive(
    input: RevokePluginInstallation,
  ): Promise<PluginInstallationRecord | undefined> {
    const safe = validateRevocation(input);
    const updated = await this.client.query<PluginInstallationRow>(
      `UPDATE plugin_integration.plugin_installation_record
       SET installation_status = 'revoked',
           revoked_at = $3::timestamptz
       WHERE installation_id = $1::uuid
         AND workspace_id = $2::uuid
         AND installation_status = 'active'
         AND installed_at <= $3::timestamptz
       RETURNING ${RETURNING_COLUMNS}`,
      [safe.installationId, safe.workspaceId, safe.revokedAt],
    );
    let row = oneOrUndefined(updated.rows);
    if (!row) {
      const existing = await this.client.query<PluginInstallationRow>(
        `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_installation_record
         WHERE installation_id = $1::uuid
           AND workspace_id = $2::uuid
           AND installation_status = 'revoked'
         LIMIT 2`,
        [safe.installationId, safe.workspaceId],
      );
      row = oneOrUndefined(existing.rows);
    }
    if (!row) {
      return undefined;
    }
    const durable = parseRow(row);
    if (
      durable.installationId !== safe.installationId ||
      durable.workspaceId !== safe.workspaceId ||
      durable.status !== 'revoked'
    ) {
      return invalidEvidence();
    }
    return durable;
  }
}
