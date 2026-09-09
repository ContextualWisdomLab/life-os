import type {
  PluginDeliveryAttemptControlCommand,
  PluginDeliveryAttemptControlEvidence,
  PluginDeliveryAttemptControlStore,
} from './plugin-delivery-attempt-control';

const CONTROL_AUTHORITY_VERSION =
  'life-os.plugin-delivery-attempt-control.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Result returned by the bounded delivery-control SQL client. */
export interface PluginDeliveryAttemptControlSqlResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/** Minimal parameterized SQL authority required by the delivery-control store. */
export interface PluginDeliveryAttemptControlSqlClient {
  /** Executes one parameterized SQL statement without exposing connection authority. */
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginDeliveryAttemptControlSqlResult<Row>>;
}

/** Rejects malformed control input before SQL authority is exercised. */
export class PluginDeliveryAttemptControlPersistenceValidationError extends Error {
  /** Creates one fixed input error without reflecting command data. */
  constructor() {
    super('Plugin delivery attempt control persistence input is invalid');
    this.name = 'PluginDeliveryAttemptControlPersistenceValidationError';
  }
}

/** Rejects ambiguous or corrupt durable control evidence. */
export class PluginDeliveryAttemptControlPersistenceEvidenceError extends Error {
  /** Creates one fixed evidence error without reflecting database detail. */
  constructor() {
    super('Persisted plugin delivery attempt control evidence is invalid');
    this.name = 'PluginDeliveryAttemptControlPersistenceEvidenceError';
  }
}

interface ControlRow {
  authority_version: unknown;
  delivery_id: unknown;
  workspace_id: unknown;
  requested_by_user_id: unknown;
  control_sequence: unknown;
  delivery_status: unknown;
  updated_at: unknown;
  next_attempt_at: unknown;
  terminal_at: unknown;
}

function invalidInput(): never {
  throw new PluginDeliveryAttemptControlPersistenceValidationError();
}

function invalidEvidence(): never {
  throw new PluginDeliveryAttemptControlPersistenceEvidenceError();
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

function validateCommand(
  value: PluginDeliveryAttemptControlCommand,
): PluginDeliveryAttemptControlCommand {
  if (value === null || typeof value !== 'object') {
    return invalidInput();
  }
  if (boundedInputRead(() => Array.isArray(value))) {
    return invalidInput();
  }
  const command = value as PluginDeliveryAttemptControlCommand;
  const snapshot = boundedInputRead(() => ({
    deliveryId: command.deliveryId,
    workspaceId: command.workspaceId,
    requestedByUserId: command.requestedByUserId,
    occurredAt: command.occurredAt,
  }));
  return Object.freeze({
    deliveryId: requireInputUuid(snapshot.deliveryId),
    workspaceId: requireInputUuid(snapshot.workspaceId),
    requestedByUserId: requireInputUuid(snapshot.requestedByUserId),
    occurredAt: requireInputInstant(snapshot.occurredAt),
  });
}

function singleRow<Row>(
  result: PluginDeliveryAttemptControlSqlResult<Row>,
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
  return rowsLength === 0 ? undefined : boundedEvidenceRead(() => rows[0]);
}

function parseEvidence(
  row: unknown,
  command: PluginDeliveryAttemptControlCommand,
  controlCode: PluginDeliveryAttemptControlEvidence['controlCode'],
): PluginDeliveryAttemptControlEvidence {
  if (row === null || typeof row !== 'object') {
    return invalidEvidence();
  }
  if (boundedEvidenceRead(() => Array.isArray(row))) {
    return invalidEvidence();
  }
  const candidate = row as ControlRow;
  const snapshot = boundedEvidenceRead(() => ({
    authorityVersion: candidate.authority_version,
    deliveryId: candidate.delivery_id,
    workspaceId: candidate.workspace_id,
    requestedByUserId: candidate.requested_by_user_id,
    controlSequence: candidate.control_sequence,
    deliveryStatus: candidate.delivery_status,
    updatedAt: candidate.updated_at,
    nextAttemptAt: candidate.next_attempt_at,
    terminalAt: candidate.terminal_at,
  }));
  if (
    snapshot.authorityVersion !== CONTROL_AUTHORITY_VERSION ||
    snapshot.deliveryId !== command.deliveryId ||
    snapshot.workspaceId !== command.workspaceId ||
    snapshot.requestedByUserId !== command.requestedByUserId ||
    typeof snapshot.controlSequence !== 'number' ||
    !Number.isInteger(snapshot.controlSequence) ||
    snapshot.controlSequence < 1
  ) {
    return invalidEvidence();
  }
  const occurredAt = requireStoredInstant(snapshot.updatedAt);
  if (occurredAt !== command.occurredAt) {
    return invalidEvidence();
  }
  const nextAttemptAt = requireNullableStoredInstant(snapshot.nextAttemptAt);
  const terminalAt = requireNullableStoredInstant(snapshot.terminalAt);
  if (
    (controlCode === 'pause' &&
      (snapshot.deliveryStatus !== 'paused' ||
        nextAttemptAt === null ||
        terminalAt !== null)) ||
    (controlCode === 'resume' &&
      (snapshot.deliveryStatus !== 'pending' ||
        nextAttemptAt !== occurredAt ||
        terminalAt !== null)) ||
    (controlCode === 'dead_letter' &&
      (snapshot.deliveryStatus !== 'dead_lettered' ||
        nextAttemptAt !== null ||
        terminalAt === null ||
        new Date(terminalAt).getTime() > new Date(occurredAt).getTime()))
  ) {
    return invalidEvidence();
  }
  return Object.freeze({
    authorityVersion: CONTROL_AUTHORITY_VERSION,
    deliveryId: command.deliveryId,
    workspaceId: command.workspaceId,
    requestedByUserId: command.requestedByUserId,
    controlSequence: snapshot.controlSequence,
    controlCode,
    deliveryStatus: snapshot.deliveryStatus as
      'paused' | 'pending' | 'dead_lettered',
    occurredAt,
    nextAttemptAt,
    terminalAt,
  });
}

/** PostgreSQL adapter for explicit Integration-owned delivery lifecycle controls. */
export class PostgresPluginDeliveryAttemptControlStore implements PluginDeliveryAttemptControlStore {
  /** Creates the store over one bounded parameterized SQL client. */
  constructor(private readonly client: PluginDeliveryAttemptControlSqlClient) {}

  /** Pauses one unclaimed pending delivery while preserving retry identity. */
  async pause(
    commandValue: PluginDeliveryAttemptControlCommand,
  ): Promise<PluginDeliveryAttemptControlEvidence | undefined> {
    return this.apply('pause', commandValue);
  }

  /** Resumes one paused delivery as immediately due without resetting retry identity. */
  async resume(
    commandValue: PluginDeliveryAttemptControlCommand,
  ): Promise<PluginDeliveryAttemptControlEvidence | undefined> {
    return this.apply('resume', commandValue);
  }

  /** Dead-letters one terminal retry-exhausted delivery while preserving terminal time. */
  async deadLetter(
    commandValue: PluginDeliveryAttemptControlCommand,
  ): Promise<PluginDeliveryAttemptControlEvidence | undefined> {
    return this.apply('dead_letter', commandValue);
  }

  private async apply(
    controlCode: PluginDeliveryAttemptControlEvidence['controlCode'],
    commandValue: PluginDeliveryAttemptControlCommand,
  ): Promise<PluginDeliveryAttemptControlEvidence | undefined> {
    const command = validateCommand(commandValue);
    const result = await boundedEvidenceDependency(() =>
      this.client.query<ControlRow>(
        controlCode === 'pause'
          ? `UPDATE plugin_integration.plugin_delivery_attempt_record
             SET delivery_status = 'paused',
                 updated_at = $2::timestamptz,
                 control_sequence = control_sequence + 1
             WHERE delivery_id = $1::uuid
               AND workspace_id = $3::uuid
               AND requested_by_user_id = $4::uuid
               AND delivery_status = 'pending'
               AND claim_token_digest IS NULL
               AND claim_started_at IS NULL
               AND claim_expires_at IS NULL
             RETURNING 'life-os.plugin-delivery-attempt-control.v1'::text AS authority_version,
                       delivery_id, workspace_id, requested_by_user_id,
                       control_sequence, delivery_status, updated_at,
                       next_attempt_at, terminal_at`
          : controlCode === 'resume'
            ? `UPDATE plugin_integration.plugin_delivery_attempt_record
               SET delivery_status = 'pending',
                   updated_at = $2::timestamptz,
                   next_attempt_at = $2::timestamptz,
                   control_sequence = control_sequence + 1
               WHERE delivery_id = $1::uuid
                 AND workspace_id = $3::uuid
                 AND requested_by_user_id = $4::uuid
                 AND delivery_status = 'paused'
                 AND claim_token_digest IS NULL
                 AND claim_started_at IS NULL
                 AND claim_expires_at IS NULL
               RETURNING 'life-os.plugin-delivery-attempt-control.v1'::text AS authority_version,
                         delivery_id, workspace_id, requested_by_user_id,
                         control_sequence, delivery_status, updated_at,
                         next_attempt_at, terminal_at`
            : `UPDATE plugin_integration.plugin_delivery_attempt_record
               SET delivery_status = 'dead_lettered',
                   updated_at = $2::timestamptz,
                   control_sequence = control_sequence + 1
               WHERE delivery_id = $1::uuid
                 AND workspace_id = $3::uuid
                 AND requested_by_user_id = $4::uuid
                 AND delivery_status = 'failed'
                 AND attempt_count = max_attempts
                 AND last_outcome_code = 'attempt_limit'
                 AND next_attempt_at IS NULL
                 AND terminal_at IS NOT NULL
                 AND claim_token_digest IS NULL
                 AND claim_started_at IS NULL
                 AND claim_expires_at IS NULL
               RETURNING 'life-os.plugin-delivery-attempt-control.v1'::text AS authority_version,
                         delivery_id, workspace_id, requested_by_user_id,
                         control_sequence, delivery_status, updated_at,
                         next_attempt_at, terminal_at`,
        [
          command.deliveryId,
          command.occurredAt,
          command.workspaceId,
          command.requestedByUserId,
        ],
      ),
    );
    const row = singleRow(result);
    return row === undefined
      ? undefined
      : parseEvidence(row, command, controlCode);
  }
}
