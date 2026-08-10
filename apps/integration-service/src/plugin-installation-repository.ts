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
const MAXIMUM_REPLAY_ATTEMPTS = 3;
const REPLAY_DELAY_MILLISECONDS = 10;

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

/** Untrusted database row shape validated before it becomes installation evidence. */
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

/** Fails closed for malformed caller input without reflecting the bad value. */
function invalidInput(): never {
  throw new PluginInstallationPersistenceValidationError();
}

/** Fails closed when PostgreSQL returns ambiguous or impossible durable evidence. */
function invalidEvidence(): never {
  throw new PluginInstallationPersistenceEvidenceError();
}

/** Normalizes a caller-supplied UUIDv4 or rejects it before SQL execution. */
function inputUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidInput();
  }
  return value.toLowerCase();
}

/** Normalizes a persisted UUIDv4 or rejects corrupted database evidence. */
function storedUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidEvidence();
  }
  return value.toLowerCase();
}

/** Parses one canonical UTC instant using the caller-selected fail-closed path. */
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

/** Validates bounded caller text before it can become a SQL parameter. */
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

/** Validates bounded persisted text before it can become trusted evidence. */
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

/** Validates a caller-supplied lowercase SHA-256 digest. */
function inputDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

/** Validates a persisted lowercase SHA-256 digest. */
function storedDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalidEvidence();
  }
  return value;
}

/** Requires a bounded, unique, already-sorted caller capability set. */
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

/** Requires persisted capabilities to remain bounded, unique, and canonical. */
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

/** Returns at most one row and rejects ambiguous duplicate durable evidence. */
function oneOrUndefined<Row>(rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) {
    return invalidEvidence();
  }
  return rows[0];
}

/** Validates and freezes one new active installation before persistence. */
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

/** Validates revocation authority including installation, workspace, and installer. */
function validateRevocation(
  input: RevokePluginInstallation,
): RevokePluginInstallation {
  return Object.freeze({
    installationId: inputUuid(input.installationId),
    workspaceId: inputUuid(input.workspaceId),
    installedByUserId: inputUuid(input.installedByUserId),
    revokedAt: parseInstant(input.revokedAt, invalidInput),
  });
}

/**
 * Converts one untrusted row into a coherent installation record.
 *
 * Lifecycle/timestamp contradictions and malformed identifiers fail closed rather
 * than becoming application authority.
 */
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

/**
 * Confirms that durable active authority is the same immutable installation.
 *
 * `installedAt` is intentionally not compared: on an exact idempotent replay the
 * original durable timestamp is authoritative and a later retry timestamp must
 * not rewrite history.
 */
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

/** Waits briefly before another conflict-winner visibility probe. */
async function waitForReplayVisibility(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, REPLAY_DELAY_MILLISECONDS);
  });
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
    for (
      let attempt = 0;
      !row && attempt < MAXIMUM_REPLAY_ATTEMPTS;
      attempt += 1
    ) {
      if (attempt > 0) {
        await waitForReplayVisibility();
      }
      const existing = await this.client.query<PluginInstallationRow>(
        `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_installation_record
         WHERE installation_id = $1::uuid
           AND workspace_id = $2::uuid
           AND installed_by_user_id = $3::uuid
         LIMIT 2`,
        [safe.installationId, safe.workspaceId, safe.installedByUserId],
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

  /** Reads one installation only inside authenticated workspace-and-user scope. */
  async findById(
    installationIdInput: string,
    workspaceIdInput: string,
    installedByUserIdInput: string,
  ): Promise<PluginInstallationRecord | undefined> {
    const installationId = inputUuid(installationIdInput);
    const workspaceId = inputUuid(workspaceIdInput);
    const installedByUserId = inputUuid(installedByUserIdInput);
    const result = await this.client.query<PluginInstallationRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM plugin_integration.plugin_installation_record
       WHERE installation_id = $1::uuid
         AND workspace_id = $2::uuid
         AND installed_by_user_id = $3::uuid
       LIMIT 2`,
      [installationId, workspaceId, installedByUserId],
    );
    const row = oneOrUndefined(result.rows);
    if (!row) {
      return undefined;
    }
    const durable = parseRow(row);
    if (
      durable.installationId !== installationId ||
      durable.workspaceId !== workspaceId ||
      durable.installedByUserId !== installedByUserId
    ) {
      return invalidEvidence();
    }
    return durable;
  }

  /** Atomically revokes installer-owned authority or returns an exact revoked replay. */
  async revokeActive(
    input: RevokePluginInstallation,
  ): Promise<PluginInstallationRecord | undefined> {
    const safe = validateRevocation(input);
    const updated = await this.client.query<PluginInstallationRow>(
      `UPDATE plugin_integration.plugin_installation_record
       SET installation_status = 'revoked',
           revoked_at = $4::timestamptz
       WHERE installation_id = $1::uuid
         AND workspace_id = $2::uuid
         AND installed_by_user_id = $3::uuid
         AND installation_status = 'active'
         AND installed_at <= $4::timestamptz
       RETURNING ${RETURNING_COLUMNS}`,
      [
        safe.installationId,
        safe.workspaceId,
        safe.installedByUserId,
        safe.revokedAt,
      ],
    );
    let row = oneOrUndefined(updated.rows);
    if (!row) {
      const existing = await this.client.query<PluginInstallationRow>(
        `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_installation_record
         WHERE installation_id = $1::uuid
           AND workspace_id = $2::uuid
           AND installed_by_user_id = $3::uuid
           AND installation_status = 'revoked'
         LIMIT 2`,
        [safe.installationId, safe.workspaceId, safe.installedByUserId],
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
      durable.installedByUserId !== safe.installedByUserId ||
      durable.status !== 'revoked'
    ) {
      return invalidEvidence();
    }
    return durable;
  }
}
