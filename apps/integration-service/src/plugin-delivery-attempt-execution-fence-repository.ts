import type {
  PluginDeliveryAttemptExecutionFenceCommand,
  PluginDeliveryAttemptExecutionFenceEvidence,
  PluginDeliveryAttemptExecutionFenceStore,
} from './plugin-delivery-attempt-execution-fence';

const FENCE_AUTHORITY_VERSION =
  'life-os.plugin-delivery-attempt-execution-fence.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_ATTEMPT_NUMBER = 10;

/** Result returned by the bounded execution-fence SQL client. */
export interface PluginDeliveryAttemptExecutionFenceSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal parameterized SQL authority required by the execution-fence store. */
export interface PluginDeliveryAttemptExecutionFenceSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginDeliveryAttemptExecutionFenceSqlResult<Row>>;
}

/** Rejects malformed fence input before any SQL authority is exercised. */
export class PluginDeliveryAttemptExecutionFencePersistenceValidationError extends Error {
  /** Creates a fixed input failure without reflecting command data. */
  constructor() {
    super('Plugin delivery attempt execution fence persistence input is invalid');
    this.name = 'PluginDeliveryAttemptExecutionFencePersistenceValidationError';
  }
}

/** Rejects ambiguous or corrupt durable fence evidence. */
export class PluginDeliveryAttemptExecutionFencePersistenceEvidenceError extends Error {
  /** Creates a fixed evidence failure without reflecting database detail. */
  constructor() {
    super('Persisted plugin delivery attempt execution fence evidence is invalid');
    this.name = 'PluginDeliveryAttemptExecutionFencePersistenceEvidenceError';
  }
}

interface ExecutionFenceRow {
  authority_version: unknown;
  delivery_id: unknown;
  grant_id: unknown;
  installation_id: unknown;
  workspace_id: unknown;
  requested_by_user_id: unknown;
  attempt_count: unknown;
  checked_at: unknown;
  claim_expires_at: unknown;
}

function invalidInput(): never {
  throw new PluginDeliveryAttemptExecutionFencePersistenceValidationError();
}

function invalidEvidence(): never {
  throw new PluginDeliveryAttemptExecutionFencePersistenceEvidenceError();
}

function boundedInputRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalidInput();
  }
}

function boundedEvidenceRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalidEvidence();
  }
}

async function boundedEvidenceDependency<T>(
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch {
    return invalidEvidence();
  }
}

function requireInputUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

function requireStoredUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidEvidence();
  }
  return value;
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
  const candidate = boundedEvidenceRead(() =>
    value instanceof Date ? value.toISOString() : value,
  );
  if (typeof candidate !== 'string' || !ISO_INSTANT_PATTERN.test(candidate)) {
    return invalidEvidence();
  }
  const instant = new Date(candidate);
  if (
    !Number.isFinite(instant.getTime()) ||
    instant.toISOString() !== candidate
  ) {
    return invalidEvidence();
  }
  return candidate;
}

function validateCommand(
  value: PluginDeliveryAttemptExecutionFenceCommand,
): PluginDeliveryAttemptExecutionFenceCommand {
  if (value === null || typeof value !== 'object') {
    return invalidInput();
  }
  if (boundedInputRead(() => Array.isArray(value))) {
    return invalidInput();
  }
  const command = value as PluginDeliveryAttemptExecutionFenceCommand;
  const snapshot = boundedInputRead(() => ({
    deliveryId: command.deliveryId,
    workspaceId: command.workspaceId,
    requestedByUserId: command.requestedByUserId,
    claimTokenDigest: command.claimTokenDigest,
    checkedAt: command.checkedAt,
  }));
  if (
    typeof snapshot.claimTokenDigest !== 'string' ||
    !SHA256_PATTERN.test(snapshot.claimTokenDigest)
  ) {
    return invalidInput();
  }
  return Object.freeze({
    deliveryId: requireInputUuid(snapshot.deliveryId),
    workspaceId: requireInputUuid(snapshot.workspaceId),
    requestedByUserId: requireInputUuid(snapshot.requestedByUserId),
    claimTokenDigest: snapshot.claimTokenDigest,
    checkedAt: requireInputInstant(snapshot.checkedAt),
  });
}

function singleRow<Row>(
  result: PluginDeliveryAttemptExecutionFenceSqlResult<Row>,
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
  return boundedEvidenceRead(() => rows[0]);
}

function parseEvidence(
  row: unknown,
  command: PluginDeliveryAttemptExecutionFenceCommand,
): PluginDeliveryAttemptExecutionFenceEvidence {
  if (row === null || typeof row !== 'object') {
    return invalidEvidence();
  }
  if (boundedEvidenceRead(() => Array.isArray(row))) {
    return invalidEvidence();
  }
  const candidate = row as ExecutionFenceRow;
  const snapshot = boundedEvidenceRead(() => ({
    authorityVersion: candidate.authority_version,
    deliveryId: candidate.delivery_id,
    grantId: candidate.grant_id,
    installationId: candidate.installation_id,
    workspaceId: candidate.workspace_id,
    requestedByUserId: candidate.requested_by_user_id,
    attemptNumber: candidate.attempt_count,
    checkedAt: candidate.checked_at,
    claimExpiresAt: candidate.claim_expires_at,
  }));
  if (
    snapshot.authorityVersion !== FENCE_AUTHORITY_VERSION ||
    snapshot.deliveryId !== command.deliveryId ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.requestedByUserId !== command.requestedByUserId ||
    typeof snapshot.attemptNumber !== 'number' ||
    !Number.isInteger(snapshot.attemptNumber) ||
    snapshot.attemptNumber < 1 ||
    snapshot.attemptNumber > MAXIMUM_ATTEMPT_NUMBER
  ) {
    return invalidEvidence();
  }
  const checkedAt = requireStoredInstant(snapshot.checkedAt);
  const claimExpiresAt = requireStoredInstant(snapshot.claimExpiresAt);
  if (
    checkedAt !== command.checkedAt ||
    new Date(claimExpiresAt).getTime() <= new Date(checkedAt).getTime()
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    authorityVersion: FENCE_AUTHORITY_VERSION,
    deliveryId: requireStoredUuid(snapshot.deliveryId),
    grantId: requireStoredUuid(snapshot.grantId),
    installationId: requireStoredUuid(snapshot.installationId),
    workspaceId: requireStoredUuid(snapshot.workspaceId),
    requestedByUserId: requireStoredUuid(snapshot.requestedByUserId),
    attemptNumber: snapshot.attemptNumber,
    checkedAt,
    claimExpiresAt,
  });
}

/** PostgreSQL adapter for immediate Integration-owned delivery execution authority. */
export class PostgresPluginDeliveryAttemptExecutionFenceStore implements PluginDeliveryAttemptExecutionFenceStore {
  /** Creates the store over one bounded parameterized SQL client. */
  constructor(
    private readonly client: PluginDeliveryAttemptExecutionFenceSqlClient,
  ) {}

  /** Revalidates the exact live claim, origin grant, and owning installation. */
  async check(
    commandValue: PluginDeliveryAttemptExecutionFenceCommand,
  ): Promise<PluginDeliveryAttemptExecutionFenceEvidence | undefined> {
    const command = validateCommand(commandValue);
    const result = await boundedEvidenceDependency(() =>
      this.client.query<ExecutionFenceRow>(
        `SELECT 'life-os.plugin-delivery-attempt-execution-fence.v1'::text AS authority_version,
                attempt.delivery_id,
                attempt.grant_id,
                attempt.installation_id,
                attempt.workspace_id,
                attempt.requested_by_user_id,
                attempt.attempt_count,
                $5::timestamptz AS checked_at,
                attempt.claim_expires_at
           FROM plugin_integration.plugin_delivery_attempt_record AS attempt
           JOIN plugin_integration.plugin_delivery_origin_grant_record AS grant_record
             ON grant_record.grant_id = attempt.grant_id
            AND grant_record.installation_id = attempt.installation_id
            AND grant_record.workspace_id = attempt.workspace_id
            AND grant_record.granted_by_user_id = attempt.requested_by_user_id
           JOIN plugin_integration.plugin_installation_record AS installation_record
             ON installation_record.installation_id = attempt.installation_id
            AND installation_record.workspace_id = attempt.workspace_id
            AND installation_record.installed_by_user_id = attempt.requested_by_user_id
          WHERE attempt.delivery_id = $1::uuid
            AND attempt.workspace_id = $2::uuid
            AND attempt.requested_by_user_id = $3::uuid
            AND attempt.claim_token_digest = $4
            AND attempt.delivery_status = 'pending'
            AND attempt.attempt_count BETWEEN 1 AND attempt.max_attempts
            AND attempt.claim_started_at IS NOT NULL
            AND attempt.claim_started_at <= $5::timestamptz
            AND attempt.claim_expires_at > $5::timestamptz
            AND grant_record.grant_status = 'active'
            AND grant_record.revoked_at IS NULL
            AND grant_record.granted_at <= $5::timestamptz
            AND installation_record.installation_status = 'active'
            AND installation_record.revoked_at IS NULL
            AND installation_record.installed_at <= $5::timestamptz
          LIMIT 2`,
        [
          command.deliveryId,
          command.workspaceId,
          command.requestedByUserId,
          command.claimTokenDigest,
          command.checkedAt,
        ],
      ),
    );
    const row = singleRow(result);
    if (row === undefined) {
      return undefined;
    }
    return parseEvidence(row, command);
  }
}
