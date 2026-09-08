import type {
  PluginDeliveryAttemptClaimCommand,
  PluginDeliveryAttemptClaimEvidence,
  PluginDeliveryAttemptClaimStore,
} from './plugin-delivery-attempt-claim';

const ATTEMPT_AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt.v1' as const;
const CLAIM_AUTHORITY_VERSION =
  'life-os.plugin-delivery-attempt-claim.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Result returned by the bounded delivery-claim SQL client. */
export interface PluginDeliveryAttemptClaimSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal parameterized SQL authority required by the claim/lease store. */
export interface PluginDeliveryAttemptClaimSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginDeliveryAttemptClaimSqlResult<Row>>;
}

/** Rejects malformed claim input before any SQL authority is exercised. */
export class PluginDeliveryAttemptClaimPersistenceValidationError extends Error {
  /** Creates a fixed input failure without reflecting command data. */
  constructor() {
    super('Plugin delivery attempt claim persistence input is invalid');
    this.name = 'PluginDeliveryAttemptClaimPersistenceValidationError';
  }
}

/** Rejects ambiguous or corrupt durable claim evidence. */
export class PluginDeliveryAttemptClaimPersistenceEvidenceError extends Error {
  /** Creates a fixed evidence failure without reflecting database detail. */
  constructor() {
    super('Persisted plugin delivery attempt claim evidence is invalid');
    this.name = 'PluginDeliveryAttemptClaimPersistenceEvidenceError';
  }
}

interface ClaimRow {
  authority_version: unknown;
  delivery_id: unknown;
  workspace_id: unknown;
  requested_by_user_id: unknown;
  attempt_count: unknown;
  max_attempts: unknown;
  claim_token_digest: unknown;
  claim_started_at: unknown;
  claim_expires_at: unknown;
}

function invalidInput(): never {
  throw new PluginDeliveryAttemptClaimPersistenceValidationError();
}

function invalidEvidence(): never {
  throw new PluginDeliveryAttemptClaimPersistenceEvidenceError();
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
  value: PluginDeliveryAttemptClaimCommand,
): PluginDeliveryAttemptClaimCommand {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidInput();
  }
  const command = value as PluginDeliveryAttemptClaimCommand;
  const snapshot = boundedInputRead(() => ({
    deliveryId: command.deliveryId,
    workspaceId: command.workspaceId,
    requestedByUserId: command.requestedByUserId,
    claimTokenDigest: command.claimTokenDigest,
    claimedAt: command.claimedAt,
    leaseExpiresAt: command.leaseExpiresAt,
  }));
  const deliveryId = requireInputUuid(snapshot.deliveryId);
  const workspaceId = requireInputUuid(snapshot.workspaceId);
  const requestedByUserId = requireInputUuid(snapshot.requestedByUserId);
  if (
    typeof snapshot.claimTokenDigest !== 'string' ||
    !SHA256_PATTERN.test(snapshot.claimTokenDigest)
  ) {
    return invalidInput();
  }
  const claimedAt = requireInputInstant(snapshot.claimedAt);
  const leaseExpiresAt = requireInputInstant(snapshot.leaseExpiresAt);
  const leaseMs =
    new Date(leaseExpiresAt).getTime() - new Date(claimedAt).getTime();
  if (leaseMs < 30_000 || leaseMs > 3_600_000) {
    return invalidInput();
  }
  return Object.freeze({
    deliveryId,
    workspaceId,
    requestedByUserId,
    claimTokenDigest: snapshot.claimTokenDigest,
    claimedAt,
    leaseExpiresAt,
  });
}

function singleRow<Row>(
  result: PluginDeliveryAttemptClaimSqlResult<Row>,
): Row | undefined {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return invalidEvidence();
  }
  const [rows, rowCount] = boundedEvidenceRead(
    () => [result.rows, result.rowCount] as const,
  );
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
  return rows[0];
}

function parseEvidence(
  row: unknown,
  command: PluginDeliveryAttemptClaimCommand,
): PluginDeliveryAttemptClaimEvidence {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return invalidEvidence();
  }
  const candidate = row as ClaimRow;
  const snapshot = boundedEvidenceRead(() => ({
    authorityVersion: candidate.authority_version,
    deliveryId: candidate.delivery_id,
    workspaceId: candidate.workspace_id,
    requestedByUserId: candidate.requested_by_user_id,
    attemptNumber: candidate.attempt_count,
    maxAttempts: candidate.max_attempts,
    claimTokenDigest: candidate.claim_token_digest,
    claimedAt: candidate.claim_started_at,
    leaseExpiresAt: candidate.claim_expires_at,
  }));
  if (
    snapshot.authorityVersion !== ATTEMPT_AUTHORITY_VERSION ||
    snapshot.deliveryId !== command.deliveryId ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.requestedByUserId !== command.requestedByUserId ||
    snapshot.claimTokenDigest !== command.claimTokenDigest ||
    typeof snapshot.attemptNumber !== 'number' ||
    !Number.isInteger(snapshot.attemptNumber) ||
    snapshot.attemptNumber < 1 ||
    typeof snapshot.maxAttempts !== 'number' ||
    !Number.isInteger(snapshot.maxAttempts) ||
    snapshot.maxAttempts < 1 ||
    snapshot.maxAttempts > 10 ||
    snapshot.attemptNumber > snapshot.maxAttempts
  ) {
    return invalidEvidence();
  }
  const claimedAt = requireStoredInstant(snapshot.claimedAt);
  const leaseExpiresAt = requireStoredInstant(snapshot.leaseExpiresAt);
  if (
    claimedAt !== command.claimedAt ||
    leaseExpiresAt !== command.leaseExpiresAt ||
    new Date(leaseExpiresAt).getTime() <= new Date(claimedAt).getTime()
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    authorityVersion: CLAIM_AUTHORITY_VERSION,
    deliveryId: requireStoredUuid(snapshot.deliveryId),
    workspaceId: requireStoredUuid(snapshot.workspaceId),
    requestedByUserId: requireStoredUuid(snapshot.requestedByUserId),
    attemptNumber: snapshot.attemptNumber,
    claimedAt,
    leaseExpiresAt,
  });
}

/** PostgreSQL adapter for deterministic Integration-owned attempt claim/lease acquisition. */
export class PostgresPluginDeliveryAttemptClaimStore implements PluginDeliveryAttemptClaimStore {
  /** Creates the store over one bounded parameterized SQL client. */
  constructor(private readonly client: PluginDeliveryAttemptClaimSqlClient) {}

  /** Atomically claims one due pending row if its prior lease is absent or expired. */
  async claimDue(
    commandValue: PluginDeliveryAttemptClaimCommand,
  ): Promise<PluginDeliveryAttemptClaimEvidence | undefined> {
    const command = validateCommand(commandValue);
    const result = await boundedEvidenceDependency(() =>
      this.client.query<ClaimRow>(
        `UPDATE plugin_integration.plugin_delivery_attempt_record
       SET attempt_count = attempt_count + 1,
           updated_at = $2::timestamptz,
           claim_token_digest = $1,
           claim_started_at = $2::timestamptz,
           claim_expires_at = $3::timestamptz
       WHERE delivery_id = $4::uuid
         AND next_attempt_at <= $5::timestamptz
         AND workspace_id = $6::uuid
         AND requested_by_user_id = $7::uuid
         AND delivery_status = 'pending'
         AND attempt_count < max_attempts
         AND (claim_expires_at IS NULL OR claim_expires_at <= $5::timestamptz)
       RETURNING authority_version, delivery_id, workspace_id,
                 requested_by_user_id, attempt_count,
                 max_attempts, claim_token_digest,
                 claim_started_at, claim_expires_at`,
        [
          command.claimTokenDigest,
          command.claimedAt,
          command.leaseExpiresAt,
          command.deliveryId,
          command.claimedAt,
          command.workspaceId,
          command.requestedByUserId,
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
