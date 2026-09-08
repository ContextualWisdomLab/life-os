import type {
  PluginDeliveryAttemptStatusCommand,
  PluginDeliveryAttemptStatusEvidence,
  PluginDeliveryAttemptStatusStore,
} from './plugin-delivery-attempt-status';

const ATTEMPT_AUTHORITY_VERSION = 'life-os.plugin-delivery-attempt.v1' as const;
const STATUS_AUTHORITY_VERSION =
  'life-os.plugin-delivery-attempt-status.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MINIMUM_ATTEMPTS = 1;
const MAXIMUM_ATTEMPTS = 10;
const MINIMUM_LEASE_MILLISECONDS = 30_000;
const MAXIMUM_LEASE_MILLISECONDS = 3_600_000;

/** Result returned by the bounded status SQL client. */
export interface PluginDeliveryAttemptStatusSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal fixed-query SQL authority required by the status repository. */
export interface PluginDeliveryAttemptStatusSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginDeliveryAttemptStatusSqlResult<Row>>;
}

/** Rejects malformed status input before any persistence read. */
export class PluginDeliveryAttemptStatusPersistenceValidationError extends Error {
  /** Creates a fixed persistence-input failure without reflecting request data. */
  constructor() {
    super('Plugin delivery attempt status persistence input is invalid');
    this.name = 'PluginDeliveryAttemptStatusPersistenceValidationError';
  }
}

/** Rejects ambiguous or corrupted durable status evidence. */
export class PluginDeliveryAttemptStatusPersistenceEvidenceError extends Error {
  /** Creates a fixed durable-evidence failure without backend detail. */
  constructor() {
    super('Persisted plugin delivery attempt status evidence is invalid');
    this.name = 'PluginDeliveryAttemptStatusPersistenceEvidenceError';
  }
}

interface PluginDeliveryAttemptStatusRow {
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
  control_sequence: unknown;
  has_claim_token_digest: unknown;
  claim_started_at: unknown;
  claim_expires_at: unknown;
}

function invalidInput(): never {
  throw new PluginDeliveryAttemptStatusPersistenceValidationError();
}

function invalidEvidence(): never {
  throw new PluginDeliveryAttemptStatusPersistenceEvidenceError();
}

function boundedEvidenceRead<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalidEvidence();
  }
}

function requireObject(value: unknown): Record<string, unknown> {
  const candidate = boundedEvidenceRead(() => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, unknown>;
  });
  if (!candidate) {
    return invalidEvidence();
  }
  return candidate;
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

function requireNullableStoredInstant(value: unknown): string | null {
  return value === null ? null : requireStoredInstant(value);
}

function requireInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    return invalidEvidence();
  }
  return value;
}

function oneOrUndefined<Row>(
  result: PluginDeliveryAttemptStatusSqlResult<Row>,
): Row | undefined {
  const envelope = requireObject(result);
  const [rows, rowCount] = boundedEvidenceRead(
    () => [envelope.rows, envelope.rowCount] as const,
  );
  return boundedEvidenceRead(() => {
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
    return rows[0] as Row | undefined;
  });
}

function validateCommand(
  command: PluginDeliveryAttemptStatusCommand,
): PluginDeliveryAttemptStatusCommand {
  if (
    command === null ||
    typeof command !== 'object' ||
    Array.isArray(command)
  ) {
    return invalidInput();
  }
  const snapshot = (() => {
    try {
      return {
        deliveryId: command.deliveryId,
        workspaceId: command.workspaceId,
        requestedByUserId: command.requestedByUserId,
        checkedAt: command.checkedAt,
      };
    } catch {
      return invalidInput();
    }
  })();
  return Object.freeze({
    deliveryId: requireInputUuid(snapshot.deliveryId),
    workspaceId: requireInputUuid(snapshot.workspaceId),
    requestedByUserId: requireInputUuid(snapshot.requestedByUserId),
    checkedAt: requireInputInstant(snapshot.checkedAt),
  });
}

function requireStatus(
  value: unknown,
): PluginDeliveryAttemptStatusEvidence['deliveryStatus'] {
  if (
    value !== 'pending' &&
    value !== 'paused' &&
    value !== 'failed' &&
    value !== 'dead_lettered'
  ) {
    return invalidEvidence();
  }
  return value;
}

function requireOutcome(
  value: unknown,
): PluginDeliveryAttemptStatusEvidence['lastOutcomeCode'] {
  if (
    value !== null &&
    value !== 'retryable_failure' &&
    value !== 'attempt_limit'
  ) {
    return invalidEvidence();
  }
  return value;
}

interface ParsedClaim {
  readonly state: PluginDeliveryAttemptStatusEvidence['claimState'];
  readonly claimed: boolean;
}

function parseClaim(
  hasDigest: unknown,
  startedValue: unknown,
  expiresValue: unknown,
  checkedAt: string,
): ParsedClaim {
  if (typeof hasDigest !== 'boolean') {
    return invalidEvidence();
  }
  const startedAt = requireNullableStoredInstant(startedValue);
  const expiresAt = requireNullableStoredInstant(expiresValue);
  if (!hasDigest && startedAt === null && expiresAt === null) {
    return Object.freeze({ state: 'unclaimed', claimed: false });
  }
  if (!hasDigest || startedAt === null || expiresAt === null) {
    return invalidEvidence();
  }
  const started = new Date(startedAt).getTime();
  const expires = new Date(expiresAt).getTime();
  const checked = new Date(checkedAt).getTime();
  const lease = expires - started;
  if (
    lease < MINIMUM_LEASE_MILLISECONDS ||
    lease > MAXIMUM_LEASE_MILLISECONDS ||
    checked < started
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    state: checked < expires ? 'active' : 'expired',
    claimed: true,
  });
}

function validateLifecycle(
  status: PluginDeliveryAttemptStatusEvidence['deliveryStatus'],
  attemptCount: number,
  maxAttempts: number,
  nextAttemptAt: string | null,
  terminalAt: string | null,
  outcome: PluginDeliveryAttemptStatusEvidence['lastOutcomeCode'],
  claimed: boolean,
): void {
  const initialPending =
    status === 'pending' &&
    attemptCount === 0 &&
    nextAttemptAt !== null &&
    terminalAt === null &&
    outcome === null &&
    !claimed;
  const claimedPending =
    status === 'pending' &&
    attemptCount >= 1 &&
    attemptCount <= maxAttempts &&
    nextAttemptAt !== null &&
    terminalAt === null &&
    (outcome === null || outcome === 'retryable_failure') &&
    claimed;
  const scheduledRetry =
    status === 'pending' &&
    attemptCount >= 1 &&
    attemptCount < maxAttempts &&
    nextAttemptAt !== null &&
    terminalAt === null &&
    outcome === 'retryable_failure' &&
    !claimed;
  const paused =
    status === 'paused' &&
    nextAttemptAt !== null &&
    terminalAt === null &&
    !claimed &&
    ((attemptCount === 0 && outcome === null) ||
      (attemptCount >= 1 &&
        attemptCount < maxAttempts &&
        outcome === 'retryable_failure'));
  const failed =
    status === 'failed' &&
    attemptCount === maxAttempts &&
    nextAttemptAt === null &&
    terminalAt !== null &&
    outcome === 'attempt_limit' &&
    !claimed;
  const deadLettered =
    status === 'dead_lettered' &&
    attemptCount === maxAttempts &&
    nextAttemptAt === null &&
    terminalAt !== null &&
    outcome === 'attempt_limit' &&
    !claimed;
  if (
    !initialPending &&
    !claimedPending &&
    !scheduledRetry &&
    !paused &&
    !failed &&
    !deadLettered
  ) {
    return invalidEvidence();
  }
}

function parseRow(
  rowValue: unknown,
  command: PluginDeliveryAttemptStatusCommand,
): PluginDeliveryAttemptStatusEvidence {
  const row = requireObject(
    rowValue,
  ) as unknown as PluginDeliveryAttemptStatusRow;
  const snapshot = boundedEvidenceRead(() => ({
    authorityVersion: row.authority_version,
    deliveryId: row.delivery_id,
    grantId: row.grant_id,
    installationId: row.installation_id,
    workspaceId: row.workspace_id,
    requestedByUserId: row.requested_by_user_id,
    deliveryStatus: row.delivery_status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
    nextAttemptAt: row.next_attempt_at,
    terminalAt: row.terminal_at,
    lastOutcomeCode: row.last_outcome_code,
    controlSequence: row.control_sequence,
    hasClaimTokenDigest: row.has_claim_token_digest,
    claimStartedAt: row.claim_started_at,
    claimExpiresAt: row.claim_expires_at,
  }));
  if (snapshot.authorityVersion !== ATTEMPT_AUTHORITY_VERSION) {
    return invalidEvidence();
  }

  const deliveryId = requireStoredUuid(snapshot.deliveryId);
  const grantId = requireStoredUuid(snapshot.grantId);
  const installationId = requireStoredUuid(snapshot.installationId);
  const workspaceId = requireStoredUuid(snapshot.workspaceId);
  const requestedByUserId = requireStoredUuid(snapshot.requestedByUserId);
  const deliveryStatus = requireStatus(snapshot.deliveryStatus);
  const maxAttempts = requireInteger(
    snapshot.maxAttempts,
    MINIMUM_ATTEMPTS,
    MAXIMUM_ATTEMPTS,
  );
  const attemptCount = requireInteger(snapshot.attemptCount, 0, maxAttempts);
  const requestedAt = requireStoredInstant(snapshot.requestedAt);
  const updatedAt = requireStoredInstant(snapshot.updatedAt);
  const nextAttemptAt = requireNullableStoredInstant(snapshot.nextAttemptAt);
  const terminalAt = requireNullableStoredInstant(snapshot.terminalAt);
  const lastOutcomeCode = requireOutcome(snapshot.lastOutcomeCode);
  const controlSequence = requireInteger(
    snapshot.controlSequence,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const claim = parseClaim(
    snapshot.hasClaimTokenDigest,
    snapshot.claimStartedAt,
    snapshot.claimExpiresAt,
    command.checkedAt,
  );

  if (
    deliveryId !== command.deliveryId ||
    workspaceId !== command.workspaceId ||
    requestedByUserId !== command.requestedByUserId ||
    new Date(updatedAt).getTime() < new Date(requestedAt).getTime() ||
    new Date(updatedAt).getTime() > new Date(command.checkedAt).getTime() ||
    new Date(command.checkedAt).getTime() < new Date(requestedAt).getTime() ||
    (nextAttemptAt !== null &&
      new Date(nextAttemptAt).getTime() < new Date(requestedAt).getTime()) ||
    (terminalAt !== null &&
      (new Date(terminalAt).getTime() < new Date(requestedAt).getTime() ||
        new Date(terminalAt).getTime() > new Date(updatedAt).getTime()))
  ) {
    return invalidEvidence();
  }

  validateLifecycle(
    deliveryStatus,
    attemptCount,
    maxAttempts,
    nextAttemptAt,
    terminalAt,
    lastOutcomeCode,
    claim.claimed,
  );

  return Object.freeze({
    authorityVersion: STATUS_AUTHORITY_VERSION,
    deliveryId,
    grantId,
    installationId,
    workspaceId,
    requestedByUserId,
    deliveryStatus,
    attemptCount,
    maxAttempts,
    requestedAt,
    updatedAt,
    nextAttemptAt,
    terminalAt,
    lastOutcomeCode,
    controlSequence,
    claimState: claim.state,
    checkedAt: command.checkedAt,
  });
}

/** PostgreSQL adapter for exact scoped, credential-free delivery status reads. */
export class PostgresPluginDeliveryAttemptStatusStore implements PluginDeliveryAttemptStatusStore {
  /** Creates the store over a bounded parameterized SQL client. */
  constructor(private readonly client: PluginDeliveryAttemptStatusSqlClient) {}

  /** Reads one exact durable status without materializing claim-token digest bytes. */
  async read(
    command: PluginDeliveryAttemptStatusCommand,
  ): Promise<PluginDeliveryAttemptStatusEvidence | undefined> {
    const safe = validateCommand(command);
    const result = await this.client.query<PluginDeliveryAttemptStatusRow>(
      `SELECT authority_version, delivery_id, grant_id, installation_id,
              workspace_id, requested_by_user_id, delivery_status, attempt_count,
              max_attempts, requested_at, updated_at, next_attempt_at, terminal_at,
              last_outcome_code, control_sequence,
              (claim_token_digest IS NOT NULL) AS has_claim_token_digest,
              claim_started_at, claim_expires_at
       FROM plugin_integration.plugin_delivery_attempt_record
       WHERE delivery_id = $1::uuid
         AND workspace_id = $2::uuid
         AND requested_by_user_id = $3::uuid
       LIMIT 2`,
      [safe.deliveryId, safe.workspaceId, safe.requestedByUserId],
    );
    const row = oneOrUndefined(result);
    return row === undefined ? undefined : parseRow(row, safe);
  }
}
