import { isIP } from 'node:net';
import type {
  PluginDeliveryOriginGrantRecord,
  PluginDeliveryOriginGrantStore,
  RevokePluginDeliveryOriginGrant,
} from './plugin-delivery-origin-authority';

const AUTHORITY_VERSION = 'life-os.plugin-delivery-origin.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONTROL_OR_SEPARATOR_PATTERN = /[\p{Cc}\p{Z}]/u;
const AUTHORITY_ONLY_HTTPS_ORIGIN_PATTERN = /^https:\/\/[^/?#\\]+$/iu;
const MAXIMUM_ORIGIN_LENGTH = 512;

/** Result returned by the bounded delivery-origin SQL client. */
export interface PluginDeliveryOriginSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal fixed-query SQL authority required by the PostgreSQL grant store. */
export interface PluginDeliveryOriginSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginDeliveryOriginSqlResult<Row>>;
}

/** Rejects malformed application input before any persistence call. */
export class PluginDeliveryOriginPersistenceValidationError extends Error {
  /** Creates a fixed failure that never reflects untrusted authority input. */
  constructor() {
    super('Plugin delivery-origin persistence input is invalid');
    this.name = 'PluginDeliveryOriginPersistenceValidationError';
  }
}

/** Rejects ambiguous or corrupted durable grant evidence after persistence. */
export class PluginDeliveryOriginPersistenceEvidenceError extends Error {
  /** Creates a fixed failure without retaining persisted payload material. */
  constructor() {
    super('Persisted plugin delivery-origin evidence is invalid');
    this.name = 'PluginDeliveryOriginPersistenceEvidenceError';
  }
}

interface PluginDeliveryOriginRow {
  authority_version: unknown;
  grant_id: unknown;
  installation_id: unknown;
  workspace_id: unknown;
  granted_by_user_id: unknown;
  origin_uri: unknown;
  grant_status: unknown;
  granted_at: unknown;
  revoked_at: unknown;
}

function invalidInput(): never {
  throw new PluginDeliveryOriginPersistenceValidationError();
}

function invalidEvidence(): never {
  throw new PluginDeliveryOriginPersistenceEvidenceError();
}

function requireInputUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidInput();
  }
  return value.toLowerCase();
}

function requireStoredUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidEvidence();
  }
  const canonical = value.toLowerCase();
  if (value !== canonical) {
    return invalidEvidence();
  }
  return canonical;
}

function requireInputInstant(value: unknown): string {
  if (typeof value !== 'string' || !ISO_INSTANT_PATTERN.test(value)) {
    return invalidInput();
  }
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== value) {
    return invalidInput();
  }
  return value;
}

function requireStoredInstant(value: unknown): string {
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
  const instant = new Date(candidate);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== candidate) {
    return invalidEvidence();
  }
  return candidate;
}

function normalizedOrigin(value: unknown, evidence: boolean): string {
  const reject = evidence ? invalidEvidence : invalidInput;
  if (
    typeof value !== 'string' ||
    value.length < 9 ||
    value.length > MAXIMUM_ORIGIN_LENGTH ||
    CONTROL_OR_SEPARATOR_PATTERN.test(value) ||
    !AUTHORITY_ONLY_HTTPS_ORIGIN_PATTERN.test(value)
  ) {
    return reject();
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return reject();
  }
  const hostname =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    hostname === '' ||
    isIP(hostname) !== 0 ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.port === '0' ||
    parsed.origin !== value ||
    parsed.origin.length > MAXIMUM_ORIGIN_LENGTH
  ) {
    return reject();
  }
  return parsed.origin;
}

function oneOrUndefined<Row>(
  result: PluginDeliveryOriginSqlResult<Row>,
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
  record: PluginDeliveryOriginGrantRecord,
): PluginDeliveryOriginGrantRecord {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return invalidInput();
  }
  if (
    record.authorityVersion !== AUTHORITY_VERSION ||
    record.status !== 'active' ||
    record.revokedAt !== null
  ) {
    return invalidInput();
  }
  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    grantId: requireInputUuid(record.grantId),
    installationId: requireInputUuid(record.installationId),
    workspaceId: requireInputUuid(record.workspaceId),
    grantedByUserId: requireInputUuid(record.grantedByUserId),
    origin: normalizedOrigin(record.origin, false),
    status: 'active',
    grantedAt: requireInputInstant(record.grantedAt),
    revokedAt: null,
  });
}

function validateRevocation(
  input: RevokePluginDeliveryOriginGrant,
): RevokePluginDeliveryOriginGrant {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return invalidInput();
  }
  return Object.freeze({
    grantId: requireInputUuid(input.grantId),
    installationId: requireInputUuid(input.installationId),
    workspaceId: requireInputUuid(input.workspaceId),
    grantedByUserId: requireInputUuid(input.grantedByUserId),
    revokedAt: requireInputInstant(input.revokedAt),
  });
}

function parseRow(row: unknown): PluginDeliveryOriginGrantRecord {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return invalidEvidence();
  }
  const candidate = row as PluginDeliveryOriginRow;
  if (candidate.authority_version !== AUTHORITY_VERSION) {
    return invalidEvidence();
  }
  const status =
    candidate.grant_status === 'active' || candidate.grant_status === 'revoked'
      ? candidate.grant_status
      : invalidEvidence();
  const grantedAt = requireStoredInstant(candidate.granted_at);
  const revokedAt =
    candidate.revoked_at === null
      ? null
      : requireStoredInstant(candidate.revoked_at);
  if (
    (status === 'active' && revokedAt !== null) ||
    (status === 'revoked' && revokedAt === null) ||
    (revokedAt !== null &&
      new Date(revokedAt).getTime() < new Date(grantedAt).getTime())
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    grantId: requireStoredUuid(candidate.grant_id),
    installationId: requireStoredUuid(candidate.installation_id),
    workspaceId: requireStoredUuid(candidate.workspace_id),
    grantedByUserId: requireStoredUuid(candidate.granted_by_user_id),
    origin: normalizedOrigin(candidate.origin_uri, true),
    status,
    grantedAt,
    revokedAt,
  });
}

const RETURNING_COLUMNS = `authority_version, grant_id, installation_id, workspace_id,
         granted_by_user_id, origin_uri, grant_status, granted_at, revoked_at`;

/**
 * PostgreSQL implementation of host-owned delivery-origin grant persistence.
 *
 * The adapter stores only exact origin authority and opaque ownership identities.
 * It never performs network I/O and therefore cannot substitute for connect-time
 * DNS/IP, redirect, proxy, timeout, response-size, or credential enforcement.
 */
export class PostgresPluginDeliveryOriginGrantStore
  implements PluginDeliveryOriginGrantStore
{
  /** Creates the store over a bounded parameterized SQL client. */
  constructor(private readonly client: PluginDeliveryOriginSqlClient) {}

  /** Creates one active grant or returns the exact scoped durable replay winner. */
  async createIfAbsent(
    record: PluginDeliveryOriginGrantRecord,
  ): Promise<PluginDeliveryOriginGrantRecord> {
    const safe = validateCreate(record);
    const inserted = await this.client.query<PluginDeliveryOriginRow>(
      `INSERT INTO plugin_integration.plugin_delivery_origin_grant_record (
         authority_version, grant_id, installation_id, workspace_id,
         granted_by_user_id, origin_uri, grant_status, granted_at
       ) VALUES ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, 'active', $7::timestamptz)
       ON CONFLICT (grant_id) DO NOTHING
       RETURNING ${RETURNING_COLUMNS}`,
      [
        safe.authorityVersion,
        safe.grantId,
        safe.installationId,
        safe.workspaceId,
        safe.grantedByUserId,
        safe.origin,
        safe.grantedAt,
      ],
    );
    let durableRow = oneOrUndefined(inserted);
    if (durableRow === undefined) {
      const existing = await this.client.query<PluginDeliveryOriginRow>(
        `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_delivery_origin_grant_record
         WHERE grant_id = $1::uuid
           AND installation_id = $2::uuid
           AND workspace_id = $3::uuid
           AND granted_by_user_id = $4::uuid
         LIMIT 2`,
        [safe.grantId, safe.installationId, safe.workspaceId, safe.grantedByUserId],
      );
      durableRow = oneOrUndefined(existing);
    }
    if (durableRow === undefined) {
      return invalidEvidence();
    }
    return parseRow(durableRow);
  }

  /** Reads one grant only inside exact installation, workspace, and user authority. */
  async findById(
    grantIdInput: string,
    installationIdInput: string,
    workspaceIdInput: string,
    grantedByUserIdInput: string,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined> {
    const grantId = requireInputUuid(grantIdInput);
    const installationId = requireInputUuid(installationIdInput);
    const workspaceId = requireInputUuid(workspaceIdInput);
    const grantedByUserId = requireInputUuid(grantedByUserIdInput);
    const result = await this.client.query<PluginDeliveryOriginRow>(
      `SELECT ${RETURNING_COLUMNS}
       FROM plugin_integration.plugin_delivery_origin_grant_record
       WHERE grant_id = $1::uuid
         AND installation_id = $2::uuid
         AND workspace_id = $3::uuid
         AND granted_by_user_id = $4::uuid
       LIMIT 2`,
      [grantId, installationId, workspaceId, grantedByUserId],
    );
    const durableRow = oneOrUndefined(result);
    if (durableRow === undefined) {
      return undefined;
    }
    const durable = parseRow(durableRow);
    if (
      durable.grantId !== grantId ||
      durable.installationId !== installationId ||
      durable.workspaceId !== workspaceId ||
      durable.grantedByUserId !== grantedByUserId
    ) {
      return invalidEvidence();
    }
    return durable;
  }

  /** Atomically revokes one scoped active grant or returns its durable revoked replay. */
  async revokeActive(
    input: RevokePluginDeliveryOriginGrant,
  ): Promise<PluginDeliveryOriginGrantRecord | undefined> {
    const safe = validateRevocation(input);
    const updated = await this.client.query<PluginDeliveryOriginRow>(
      `UPDATE plugin_integration.plugin_delivery_origin_grant_record
       SET grant_status = 'revoked',
           revoked_at = $5::timestamptz
       WHERE grant_id = $1::uuid
         AND installation_id = $2::uuid
         AND workspace_id = $3::uuid
         AND granted_by_user_id = $4::uuid
         AND grant_status = 'active'
         AND granted_at <= $5::timestamptz
       RETURNING ${RETURNING_COLUMNS}`,
      [
        safe.grantId,
        safe.installationId,
        safe.workspaceId,
        safe.grantedByUserId,
        safe.revokedAt,
      ],
    );
    let durableRow = oneOrUndefined(updated);
    if (durableRow === undefined) {
      const replay = await this.client.query<PluginDeliveryOriginRow>(
        `SELECT ${RETURNING_COLUMNS}
         FROM plugin_integration.plugin_delivery_origin_grant_record
         WHERE grant_id = $1::uuid
           AND installation_id = $2::uuid
           AND workspace_id = $3::uuid
           AND granted_by_user_id = $4::uuid
           AND grant_status = 'revoked'
         LIMIT 2`,
        [safe.grantId, safe.installationId, safe.workspaceId, safe.grantedByUserId],
      );
      durableRow = oneOrUndefined(replay);
    }
    if (durableRow === undefined) {
      return undefined;
    }
    const durable = parseRow(durableRow);
    if (
      durable.grantId !== safe.grantId ||
      durable.installationId !== safe.installationId ||
      durable.workspaceId !== safe.workspaceId ||
      durable.grantedByUserId !== safe.grantedByUserId ||
      durable.status !== 'revoked'
    ) {
      return invalidEvidence();
    }
    return durable;
  }
}
