import type {
  PluginDeliveryAttemptRecord,
  PluginDeliveryAttemptStore,
} from './plugin-delivery-attempt';

const AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Result returned by the bounded delivery-attempt SQL client. */
export interface PluginDeliveryAttemptSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal fixed-query SQL authority required by the delivery-attempt store. */
export interface PluginDeliveryAttemptSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginDeliveryAttemptSqlResult<Row>>;
}

/** Rejects malformed delivery-attempt input before any persistence call. */
export class PluginDeliveryAttemptPersistenceValidationError extends Error {
  /** Creates a fixed persistence-input failure without reflecting request data. */
  constructor() {
    super('Plugin delivery attempt persistence input is invalid');
    this.name = 'PluginDeliveryAttemptPersistenceValidationError';
  }
}

/** Rejects ambiguous or corrupted delivery-attempt evidence returned by persistence. */
export class PluginDeliveryAttemptPersistenceEvidenceError extends Error {
  /** Creates a fixed durable-evidence failure without retaining request data. */
  constructor() {
    super('Persisted plugin delivery attempt evidence is invalid');
    this.name = 'PluginDeliveryAttemptPersistenceEvidenceError';
  }
}

interface PluginDeliveryAttemptRow {
  authority_version: unknown;
  delivery_id: unknown;
  grant_id: unknown;
  installation_id: unknown;
  workspace_id: unknown;
  requested_by_user_id: unknown;
  delivery_status: unknown;
  attempt_count: unknown;
  max_attempts: unknown;
  requested_at: unknown;
  updated_at: unknown;
  next_attempt_at: unknown;
  terminal_at: unknown;
  last_outcome_code: unknown;
}

function invalidInput(): never {
  throw new PluginDeliveryAttemptPersistenceValidationError();
}

function invalidEvidence(): never {
  throw new PluginDeliveryAttemptPersistenceEvidenceError();
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
  const candidate = value instanceof Date ? value.toISOString() : value;
  if (typeof candidate !== 'string' || !ISO_INSTANT_PATTERN.test(candidate)) {
    return invalidEvidence();
  }
  const instant = new Date(candidate);
  if (!Number.isFinite(instant.getTime()) || instant.toISOString() !== candidate) {
    return invalidEvidence();
  }
  return candidate;
}

function requireSmallInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  evidence: boolean,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return evidence ? invalidEvidence() : invalidInput();
  }
  return value;
}

function one<Row>(result: PluginDeliveryAttemptSqlResult<Row>): Row {
  if (
    result === null ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    !Array.isArray(result.rows) ||
    result.rowCount !== result.rows.length ||
    result.rows.length !== 1 ||
    result.rows[0] === undefined
  ) {
    return invalidEvidence();
  }
  return result.rows[0];
}

function validateCreate(record: PluginDeliveryAttemptRecord): PluginDeliveryAttemptRecord {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    return invalidInput();
  }
  if (
    record.authorityVersion !== AUTHORITY_VERSION ||
    record.status !== 'pending' ||
    record.attemptCount !== 0 ||
    record.terminalAt !== null ||
    record.lastOutcomeCode !== null
  ) {
    return invalidInput();
  }
  const requestedAt = requireInputInstant(record.requestedAt);
  const updatedAt = requireInputInstant(record.updatedAt);
  const nextAttemptAt = requireInputInstant(record.nextAttemptAt);
  if (
    new Date(updatedAt).getTime() < new Date(requestedAt).getTime() ||
    new Date(nextAttemptAt).getTime() < new Date(requestedAt).getTime()
  ) {
    return invalidInput();
  }
  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    deliveryId: requireInputUuid(record.deliveryId),
    grantId: requireInputUuid(record.grantId),
    installationId: requireInputUuid(record.installationId),
    workspaceId: requireInputUuid(record.workspaceId),
    requestedByUserId: requireInputUuid(record.requestedByUserId),
    status: 'pending',
    attemptCount: 0,
    maxAttempts: requireSmallInteger(record.maxAttempts, 1, 10, false),
    requestedAt,
    updatedAt,
    nextAttemptAt,
    terminalAt: null,
    lastOutcomeCode: null,
  });
}

function parseRow(row: unknown): PluginDeliveryAttemptRecord {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return invalidEvidence();
  }
  const candidate = row as PluginDeliveryAttemptRow;
  if (
    candidate.authority_version !== AUTHORITY_VERSION ||
    candidate.delivery_status !== 'pending' ||
    candidate.attempt_count !== 0 ||
    candidate.terminal_at !== null ||
    candidate.last_outcome_code !== null
  ) {
    return invalidEvidence();
  }
  const requestedAt = requireStoredInstant(candidate.requested_at);
  const updatedAt = requireStoredInstant(candidate.updated_at);
  const nextAttemptAt = requireStoredInstant(candidate.next_attempt_at);
  if (
    new Date(updatedAt).getTime() < new Date(requestedAt).getTime() ||
    new Date(nextAttemptAt).getTime() < new Date(requestedAt).getTime()
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    authorityVersion: AUTHORITY_VERSION,
    deliveryId: requireStoredUuid(candidate.delivery_id),
    grantId: requireStoredUuid(candidate.grant_id),
    installationId: requireStoredUuid(candidate.installation_id),
    workspaceId: requireStoredUuid(candidate.workspace_id),
    requestedByUserId: requireStoredUuid(candidate.requested_by_user_id),
    status: 'pending',
    attemptCount: 0,
    maxAttempts: requireSmallInteger(candidate.max_attempts, 1, 10, true),
    requestedAt,
    updatedAt,
    nextAttemptAt,
    terminalAt: null,
    lastOutcomeCode: null,
  });
}

const RETURNING_COLUMNS = `authority_version, delivery_id, grant_id, installation_id,
         workspace_id, requested_by_user_id, delivery_status, attempt_count,
         max_attempts, requested_at, updated_at, next_attempt_at, terminal_at,
         last_outcome_code`;

/** PostgreSQL adapter for Integration-owned durable delivery-attempt admission. */
export class PostgresPluginDeliveryAttemptStore implements PluginDeliveryAttemptStore {
  /** Creates the store over a bounded parameterized SQL client. */
  constructor(private readonly client: PluginDeliveryAttemptSqlClient) {}

  /** Creates one pending attempt or returns the exact scoped idempotency winner. */
  async createIfAbsent(
    record: PluginDeliveryAttemptRecord,
  ): Promise<PluginDeliveryAttemptRecord> {
    const safe = validateCreate(record);
    const result = await this.client.query<PluginDeliveryAttemptRow>(
      `WITH inserted AS (
         INSERT INTO plugin_integration.plugin_delivery_attempt_record (
           authority_version, delivery_id, grant_id, installation_id, workspace_id,
           requested_by_user_id, delivery_status, attempt_count, max_attempts,
           requested_at, updated_at, next_attempt_at, terminal_at, last_outcome_code
         ) VALUES (
           $1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
           'pending', 0, $7, $8::timestamptz, $8::timestamptz,
           $8::timestamptz, NULL, NULL
         )
         ON CONFLICT (delivery_id) DO NOTHING
         RETURNING ${RETURNING_COLUMNS}
       )
       SELECT ${RETURNING_COLUMNS}
       FROM inserted
       UNION ALL
       SELECT ${RETURNING_COLUMNS}
       FROM plugin_integration.plugin_delivery_attempt_record
       WHERE delivery_id = $2::uuid
         AND grant_id = $3::uuid
         AND installation_id = $4::uuid
         AND workspace_id = $5::uuid
         AND requested_by_user_id = $6::uuid
         AND delivery_status = 'pending'
         AND attempt_count = 0
         AND max_attempts = $7
       LIMIT 1`,
      [
        safe.authorityVersion,
        safe.deliveryId,
        safe.grantId,
        safe.installationId,
        safe.workspaceId,
        safe.requestedByUserId,
        safe.maxAttempts,
        safe.requestedAt,
      ],
    );
    const durable = parseRow(one(result));
    if (
      durable.deliveryId !== safe.deliveryId ||
      durable.grantId !== safe.grantId ||
      durable.installationId !== safe.installationId ||
      durable.workspaceId !== safe.workspaceId ||
      durable.requestedByUserId !== safe.requestedByUserId ||
      durable.maxAttempts !== safe.maxAttempts ||
      new Date(durable.requestedAt).getTime() > new Date(safe.requestedAt).getTime()
    ) {
      return invalidEvidence();
    }
    return durable;
  }
}
