import type {
  PluginDeliveryAttemptRetryCommand,
  PluginDeliveryAttemptRetryEvidence,
  PluginDeliveryAttemptRetryStore,
} from './plugin-delivery-attempt-retry';
import {
  PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_SQL,
  pluginDeliveryAttemptRetryBackoffSeconds,
} from './plugin-delivery-attempt-retry-policy';

const ATTEMPT_AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt.v1' as const;
const RETRY_AUTHORITY_VERSION =
  'life-os.plugin-delivery-attempt-retry.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Result returned by the bounded delivery-retry SQL client. */
export interface PluginDeliveryAttemptRetrySqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal parameterized SQL authority required by the retry-transition store. */
export interface PluginDeliveryAttemptRetrySqlClient {
  /** Executes one parameterized SQL statement without exposing connection authority. */
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginDeliveryAttemptRetrySqlResult<Row>>;
}

/** Rejects malformed retry input before SQL authority is exercised. */
export class PluginDeliveryAttemptRetryPersistenceValidationError extends Error {
  /** Creates a fixed input failure without reflecting token or command data. */
  constructor() {
    super('Plugin delivery attempt retry persistence input is invalid');
    this.name = 'PluginDeliveryAttemptRetryPersistenceValidationError';
  }
}

/** Rejects ambiguous or corrupt durable retry evidence. */
export class PluginDeliveryAttemptRetryPersistenceEvidenceError extends Error {
  /** Creates a fixed evidence failure without reflecting database detail. */
  constructor() {
    super('Persisted plugin delivery attempt retry evidence is invalid');
    this.name = 'PluginDeliveryAttemptRetryPersistenceEvidenceError';
  }
}

/** Raw retry-transition row before exact scope, chronology, and claim-consumption validation. */
interface RetryRow {
  authority_version: unknown;
  delivery_id: unknown;
  workspace_id: unknown;
  requested_by_user_id: unknown;
  attempt_count: unknown;
  max_attempts: unknown;
  delivery_status: unknown;
  updated_at: unknown;
  next_attempt_at: unknown;
  terminal_at: unknown;
  last_outcome_code: unknown;
  claim_token_digest: unknown;
  claim_started_at: unknown;
  claim_expires_at: unknown;
}

/** Terminates malformed retry commands before SQL authority is exercised. */
function invalidInput(): never {
  throw new PluginDeliveryAttemptRetryPersistenceValidationError();
}

/** Terminates ambiguous or corrupt durable retry evidence without reflecting database detail. */
function invalidEvidence(): never {
  throw new PluginDeliveryAttemptRetryPersistenceEvidenceError();
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

/** Collapses rejected SQL dependency calls into the fixed durable-evidence failure. */
async function boundedEvidenceDependency<T>(
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch {
    return invalidEvidence();
  }
}

/** Requires one canonical UUIDv4 retry-scope identifier before it can become a SQL parameter. */
function requireInputUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

/** Requires one exact command-side millisecond UTC instant before retry persistence. */
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

/** Canonicalizes PostgreSQL Date/string timestamps into exact durable retry evidence. */
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

/** Preserves absent retry/terminal instants while validating any present timestamp. */
function requireNullableStoredInstant(value: unknown): string | null {
  return value === null ? null : requireStoredInstant(value);
}

/** Snapshots exact retry command scope and digest before issuing the conditional UPDATE. */
function validateCommand(
  value: PluginDeliveryAttemptRetryCommand,
): PluginDeliveryAttemptRetryCommand {
  if (value === null || typeof value !== 'object') {
    return invalidInput();
  }
  if (boundedInputRead(() => Array.isArray(value))) {
    return invalidInput();
  }
  const command = value as PluginDeliveryAttemptRetryCommand;
  const snapshot = boundedInputRead(() => ({
    deliveryId: command.deliveryId,
    workspaceId: command.workspaceId,
    requestedByUserId: command.requestedByUserId,
    claimTokenDigest: command.claimTokenDigest,
    occurredAt: command.occurredAt,
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
  return Object.freeze({
    deliveryId,
    workspaceId,
    requestedByUserId,
    claimTokenDigest: snapshot.claimTokenDigest,
    occurredAt: requireInputInstant(snapshot.occurredAt),
  });
}

/** Admits zero or one unambiguous row from the retry UPDATE result envelope. */
function singleRow<Row>(
  result: PluginDeliveryAttemptRetrySqlResult<Row>,
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

/** Mirrors the shared retry policy in application time for exact SQL/result parity checks. */
function retryInstant(occurredAt: string, attemptNumber: number): string {
  const delaySeconds = pluginDeliveryAttemptRetryBackoffSeconds(attemptNumber);
  return new Date(
    new Date(occurredAt).getTime() + delaySeconds * 1_000,
  ).toISOString();
}

/** Parses one consumed-claim row into bounded retry or terminal-exhaustion evidence. */
function parseEvidence(
  row: unknown,
  command: PluginDeliveryAttemptRetryCommand,
): PluginDeliveryAttemptRetryEvidence {
  if (row === null || typeof row !== 'object') {
    return invalidEvidence();
  }
  if (boundedEvidenceRead(() => Array.isArray(row))) {
    return invalidEvidence();
  }
  const candidate = row as RetryRow;
  const snapshot = boundedEvidenceRead(() => ({
    authorityVersion: candidate.authority_version,
    deliveryId: candidate.delivery_id,
    workspaceId: candidate.workspace_id,
    requestedByUserId: candidate.requested_by_user_id,
    attemptNumber: candidate.attempt_count,
    maxAttempts: candidate.max_attempts,
    deliveryStatus: candidate.delivery_status,
    updatedAt: candidate.updated_at,
    nextAttemptAt: candidate.next_attempt_at,
    terminalAt: candidate.terminal_at,
    lastOutcomeCode: candidate.last_outcome_code,
    claimTokenDigest: candidate.claim_token_digest,
    claimStartedAt: candidate.claim_started_at,
    claimExpiresAt: candidate.claim_expires_at,
  }));
  if (
    snapshot.authorityVersion !== ATTEMPT_AUTHORITY_VERSION ||
    snapshot.deliveryId !== command.deliveryId ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.requestedByUserId !== command.requestedByUserId ||
    typeof snapshot.attemptNumber !== 'number' ||
    !Number.isInteger(snapshot.attemptNumber) ||
    snapshot.attemptNumber < 1 ||
    typeof snapshot.maxAttempts !== 'number' ||
    !Number.isInteger(snapshot.maxAttempts) ||
    snapshot.maxAttempts < 1 ||
    snapshot.maxAttempts > 10 ||
    snapshot.attemptNumber > snapshot.maxAttempts ||
    snapshot.claimTokenDigest !== null ||
    snapshot.claimStartedAt !== null ||
    snapshot.claimExpiresAt !== null
  ) {
    return invalidEvidence();
  }
  const occurredAt = requireStoredInstant(snapshot.updatedAt);
  if (occurredAt !== command.occurredAt) {
    return invalidEvidence();
  }
  const nextAttemptAt = requireNullableStoredInstant(snapshot.nextAttemptAt);
  const terminalAt = requireNullableStoredInstant(snapshot.terminalAt);

  if (snapshot.attemptNumber >= snapshot.maxAttempts) {
    if (
      snapshot.deliveryStatus !== 'failed' ||
      snapshot.lastOutcomeCode !== 'attempt_limit' ||
      nextAttemptAt !== null ||
      terminalAt !== occurredAt
    ) {
      return invalidEvidence();
    }
    return Object.freeze({
      authorityVersion: RETRY_AUTHORITY_VERSION,
      deliveryId: command.deliveryId,
      workspaceId: command.workspaceId,
      requestedByUserId: command.requestedByUserId,
      attemptNumber: snapshot.attemptNumber,
      maxAttempts: snapshot.maxAttempts,
      deliveryStatus: 'failed',
      occurredAt,
      nextAttemptAt: null,
      terminalAt,
      outcomeCode: 'attempt_limit',
    });
  }

  if (
    snapshot.deliveryStatus !== 'pending' ||
    snapshot.lastOutcomeCode !== 'retryable_failure' ||
    terminalAt !== null ||
    nextAttemptAt !== retryInstant(occurredAt, snapshot.attemptNumber)
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    authorityVersion: RETRY_AUTHORITY_VERSION,
    deliveryId: command.deliveryId,
    workspaceId: command.workspaceId,
    requestedByUserId: command.requestedByUserId,
    attemptNumber: snapshot.attemptNumber,
    maxAttempts: snapshot.maxAttempts,
    deliveryStatus: 'pending',
    occurredAt,
    nextAttemptAt,
    terminalAt: null,
    outcomeCode: 'retryable_failure',
  });
}

/** PostgreSQL adapter for deterministic Integration-owned retry/backoff transitions. */
export class PostgresPluginDeliveryAttemptRetryStore implements PluginDeliveryAttemptRetryStore {
  /** Creates the store over one bounded parameterized SQL client. */
  constructor(private readonly client: PluginDeliveryAttemptRetrySqlClient) {}

  /** Consumes one exact unexpired claim and records retry scheduling or terminal exhaustion. */
  async recordRetryableFailure(
    commandValue: PluginDeliveryAttemptRetryCommand,
  ): Promise<PluginDeliveryAttemptRetryEvidence | undefined> {
    const command = validateCommand(commandValue);
    const result = await boundedEvidenceDependency(() =>
      this.client.query<RetryRow>(
        `UPDATE plugin_integration.plugin_delivery_attempt_record
       SET delivery_status = CASE
             WHEN attempt_count >= max_attempts THEN 'failed'
             ELSE 'pending'
           END,
           updated_at = $2::timestamptz,
           next_attempt_at = CASE
             WHEN attempt_count >= max_attempts THEN NULL
             ELSE $2::timestamptz + make_interval(
               secs => ${PLUGIN_DELIVERY_ATTEMPT_RETRY_BACKOFF_SQL}::double precision
             )
           END,
           terminal_at = CASE
             WHEN attempt_count >= max_attempts THEN $2::timestamptz
             ELSE NULL
           END,
           last_outcome_code = CASE
             WHEN attempt_count >= max_attempts THEN 'attempt_limit'
             ELSE 'retryable_failure'
           END,
           claim_token_digest = NULL,
           claim_started_at = NULL,
           claim_expires_at = NULL
       WHERE claim_token_digest = $1
         AND claim_expires_at > $2::timestamptz
         AND delivery_id = $3::uuid
         AND workspace_id = $4::uuid
         AND requested_by_user_id = $5::uuid
         AND delivery_status = 'pending'
         AND attempt_count >= 1
         AND attempt_count <= max_attempts
       RETURNING authority_version, delivery_id, workspace_id,
                 requested_by_user_id, attempt_count, max_attempts,
                 delivery_status, updated_at, next_attempt_at, terminal_at,
                 last_outcome_code, claim_token_digest,
                 claim_started_at, claim_expires_at`,
        [
          command.claimTokenDigest,
          command.occurredAt,
          command.deliveryId,
          command.workspaceId,
          command.requestedByUserId,
        ],
      ),
    );
    const row = singleRow(result);
    return row === undefined ? undefined : parseEvidence(row, command);
  }
}
