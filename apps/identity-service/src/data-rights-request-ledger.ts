const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Query result exposed by the bounded data-rights persistence adapter. */
export interface DataRightsRequestSqlResult<Row> {
  readonly rows: Row[];
  readonly rowCount: number | null;
}

/** Minimal fixed-query SQL boundary required by the data-rights request ledger. */
export interface DataRightsRequestSqlClient {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DataRightsRequestSqlResult<Row>>;
}

/** Durable operation types supported by the data-rights orchestration ledger. */
export type DataRightsRequestKind = 'export' | 'erasure';

/** Durable request lifecycle exposed to the identity application layer. */
export type DataRightsRequestStatus = 'pending' | 'completed';

/** Credential-free durable request record returned by the ledger. */
export interface DataRightsRequestRecord {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestKind: DataRightsRequestKind;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly status: DataRightsRequestStatus;
  readonly receiptDigest: string | null;
  readonly requestedAt: string;
  readonly completedAt: string | null;
}

/** Validated input for creating or replaying one data-rights request. */
export interface BeginDataRightsRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestKind: DataRightsRequestKind;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly requestedAt: string;
}

/** Validated input for tenant-and-actor scoped request-status lookup. */
export interface GetDataRightsRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
}

/** Validated input for binding an immutable terminal receipt to one request. */
export interface CompleteDataRightsRequest {
  readonly requestId: string;
  readonly workspaceId: string;
  readonly receiptDigest: string;
  readonly completedAt: string;
}

/** Fail-closed error for malformed request-ledger input. */
export class DataRightsRequestValidationError extends Error {
  /** Creates a fixed validation error without retaining the rejected value. */
  constructor() {
    super('Data-rights request is invalid');
    this.name = 'DataRightsRequestValidationError';
  }
}

/** Stable conflict for idempotency or immutable receipt reuse. */
export class DataRightsRequestConflictError extends Error {
  /** Creates a credential-free conflict without exposing stored tenant data. */
  constructor() {
    super('Data-rights request conflicts with durable evidence');
    this.name = 'DataRightsRequestConflictError';
  }
}

/** Fail-closed error when persisted request evidence violates ledger invariants. */
export class DataRightsRequestPersistenceError extends Error {
  /** Creates a fixed persistence-corruption error. */
  constructor() {
    super('Persisted data-rights request is invalid');
    this.name = 'DataRightsRequestPersistenceError';
  }
}

interface DataRightsRequestRow {
  request_id: unknown;
  workspace_id: unknown;
  requested_by_user_id: unknown;
  request_kind: unknown;
  idempotency_key: unknown;
  request_digest: unknown;
  request_status: unknown;
  receipt_digest: unknown;
  requested_at: unknown;
  completed_at: unknown;
}

function invalidInput(): never {
  throw new DataRightsRequestValidationError();
}

function invalidPersistence(): never {
  throw new DataRightsRequestPersistenceError();
}

function requireInputUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidInput();
  }
  return value.toLowerCase();
}

function requireStoredUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return invalidPersistence();
  }
  return value.toLowerCase();
}

function requireInputDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalidInput();
  }
  return value;
}

function requireStoredDigest(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    return invalidPersistence();
  }
  return value;
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

function requireInputInstant(value: unknown): string {
  return parseInstant(value, invalidInput);
}

function requireStoredInstant(value: unknown): string {
  return parseInstant(value, invalidPersistence);
}

function requireInputKind(value: unknown): DataRightsRequestKind {
  if (value !== 'export' && value !== 'erasure') {
    return invalidInput();
  }
  return value;
}

function requireStoredKind(value: unknown): DataRightsRequestKind {
  if (value !== 'export' && value !== 'erasure') {
    return invalidPersistence();
  }
  return value;
}

function requireStoredStatus(value: unknown): DataRightsRequestStatus {
  if (value !== 'pending' && value !== 'completed') {
    return invalidPersistence();
  }
  return value;
}

function parseRequestRow(row: DataRightsRequestRow): DataRightsRequestRecord {
  const status = requireStoredStatus(row.request_status);
  const receiptDigest =
    row.receipt_digest === null ? null : requireStoredDigest(row.receipt_digest);
  const completedAt =
    row.completed_at === null ? null : requireStoredInstant(row.completed_at);
  if (
    (status === 'pending' && (receiptDigest !== null || completedAt !== null)) ||
    (status === 'completed' && (receiptDigest === null || completedAt === null))
  ) {
    return invalidPersistence();
  }
  const requestedAt = requireStoredInstant(row.requested_at);
  if (
    completedAt !== null &&
    new Date(completedAt).getTime() < new Date(requestedAt).getTime()
  ) {
    return invalidPersistence();
  }
  return Object.freeze({
    requestId: requireStoredUuid(row.request_id),
    workspaceId: requireStoredUuid(row.workspace_id),
    requestedByUserId: requireStoredUuid(row.requested_by_user_id),
    requestKind: requireStoredKind(row.request_kind),
    idempotencyKey: requireStoredUuid(row.idempotency_key),
    requestDigest: requireStoredDigest(row.request_digest),
    status,
    receiptDigest,
    requestedAt,
    completedAt,
  });
}

function oneOrUndefined<Row>(rows: readonly Row[]): Row | undefined {
  if (rows.length > 1) {
    return invalidPersistence();
  }
  return rows[0];
}

function validateBeginInput(input: BeginDataRightsRequest): BeginDataRightsRequest {
  return Object.freeze({
    requestId: requireInputUuid(input.requestId),
    workspaceId: requireInputUuid(input.workspaceId),
    requestedByUserId: requireInputUuid(input.requestedByUserId),
    requestKind: requireInputKind(input.requestKind),
    idempotencyKey: requireInputUuid(input.idempotencyKey),
    requestDigest: requireInputDigest(input.requestDigest),
    requestedAt: requireInputInstant(input.requestedAt),
  });
}

function validateGetInput(input: GetDataRightsRequest): GetDataRightsRequest {
  return Object.freeze({
    requestId: requireInputUuid(input.requestId),
    workspaceId: requireInputUuid(input.workspaceId),
    requestedByUserId: requireInputUuid(input.requestedByUserId),
  });
}

function validateCompleteInput(
  input: CompleteDataRightsRequest,
): CompleteDataRightsRequest {
  return Object.freeze({
    requestId: requireInputUuid(input.requestId),
    workspaceId: requireInputUuid(input.workspaceId),
    receiptDigest: requireInputDigest(input.receiptDigest),
    completedAt: requireInputInstant(input.completedAt),
  });
}

function requireReplayIdentity(
  record: DataRightsRequestRecord,
  input: BeginDataRightsRequest,
): void {
  if (
    record.workspaceId !== input.workspaceId ||
    record.requestedByUserId !== input.requestedByUserId ||
    record.requestKind !== input.requestKind ||
    record.idempotencyKey !== input.idempotencyKey ||
    record.requestDigest !== input.requestDigest
  ) {
    throw new DataRightsRequestConflictError();
  }
}

/**
 * PostgreSQL-backed durable ledger for replay-safe data-rights requests and
 * immutable terminal receipt digests.
 */
export class PostgresDataRightsRequestLedger {
  /** Creates the ledger over a least-authority fixed-query SQL client. */
  constructor(private readonly client: DataRightsRequestSqlClient) {}

  /** Returns one request only when request, workspace, and requesting actor match. */
  async getRequest(
    input: GetDataRightsRequest,
  ): Promise<DataRightsRequestRecord | undefined> {
    const safe = validateGetInput(input);
    const result = await this.client.query<DataRightsRequestRow>(
      `SELECT request_id, workspace_id, requested_by_user_id, request_kind,
              idempotency_key, request_digest, request_status, receipt_digest,
              requested_at, completed_at
       FROM identity.data_rights_requests
       WHERE request_id = $1::uuid
         AND workspace_id = $2::uuid
         AND requested_by_user_id = $3::uuid
       LIMIT 2`,
      [safe.requestId, safe.workspaceId, safe.requestedByUserId],
    );
    const row = oneOrUndefined(result.rows);
    return row ? parseRequestRow(row) : undefined;
  }

  /** Creates one tenant-bound request or returns its exact durable replay. */
  async beginRequest(input: BeginDataRightsRequest): Promise<{
    readonly kind: 'created' | 'replayed';
    readonly request: DataRightsRequestRecord;
  }> {
    const safe = validateBeginInput(input);
    const inserted = await this.client.query<DataRightsRequestRow>(
      `INSERT INTO identity.data_rights_requests (
         request_id,
         workspace_id,
         requested_by_user_id,
         request_kind,
         idempotency_key,
         request_digest,
         request_status,
         requested_at
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, 'pending', $7::timestamptz)
       ON CONFLICT DO NOTHING
       RETURNING request_id, workspace_id, requested_by_user_id, request_kind,
                 idempotency_key, request_digest, request_status, receipt_digest,
                 requested_at, completed_at`,
      [
        safe.requestId,
        safe.workspaceId,
        safe.requestedByUserId,
        safe.requestKind,
        safe.idempotencyKey,
        safe.requestDigest,
        safe.requestedAt,
      ],
    );
    const insertedRow = oneOrUndefined(inserted.rows);
    if (insertedRow) {
      const request = parseRequestRow(insertedRow);
      requireReplayIdentity(request, safe);
      return Object.freeze({ kind: 'created', request });
    }

    const existing = await this.client.query<DataRightsRequestRow>(
      `SELECT request_id, workspace_id, requested_by_user_id, request_kind,
              idempotency_key, request_digest, request_status, receipt_digest,
              requested_at, completed_at
       FROM identity.data_rights_requests
       WHERE (workspace_id = $1::uuid AND idempotency_key = $2::uuid)
          OR request_id = $3::uuid
       LIMIT 2`,
      [safe.workspaceId, safe.idempotencyKey, safe.requestId],
    );
    if (existing.rows.length > 1) {
      throw new DataRightsRequestConflictError();
    }
    const existingRow = oneOrUndefined(existing.rows);
    if (!existingRow) {
      return invalidPersistence();
    }
    const request = parseRequestRow(existingRow);
    requireReplayIdentity(request, safe);
    return Object.freeze({ kind: 'replayed', request });
  }

  /** Completes one pending request or replays the same immutable receipt. */
  async completeRequest(input: CompleteDataRightsRequest): Promise<{
    readonly kind: 'completed' | 'replayed';
    readonly request: DataRightsRequestRecord;
  }> {
    const safe = validateCompleteInput(input);
    const updated = await this.client.query<DataRightsRequestRow>(
      `UPDATE identity.data_rights_requests
       SET request_status = 'completed',
           receipt_digest = $3,
           completed_at = $4::timestamptz
       WHERE request_id = $1::uuid
         AND workspace_id = $2::uuid
         AND request_status = 'pending'
         AND requested_at <= $4::timestamptz
       RETURNING request_id, workspace_id, requested_by_user_id, request_kind,
                 idempotency_key, request_digest, request_status, receipt_digest,
                 requested_at, completed_at`,
      [safe.requestId, safe.workspaceId, safe.receiptDigest, safe.completedAt],
    );
    const updatedRow = oneOrUndefined(updated.rows);
    if (updatedRow) {
      const request = parseRequestRow(updatedRow);
      if (
        request.requestId !== safe.requestId ||
        request.workspaceId !== safe.workspaceId ||
        request.receiptDigest !== safe.receiptDigest
      ) {
        return invalidPersistence();
      }
      return Object.freeze({ kind: 'completed', request });
    }

    const existing = await this.client.query<DataRightsRequestRow>(
      `SELECT request_id, workspace_id, requested_by_user_id, request_kind,
              idempotency_key, request_digest, request_status, receipt_digest,
              requested_at, completed_at
       FROM identity.data_rights_requests
       WHERE request_id = $1::uuid AND workspace_id = $2::uuid
       LIMIT 2`,
      [safe.requestId, safe.workspaceId],
    );
    const existingRow = oneOrUndefined(existing.rows);
    if (!existingRow) {
      throw new DataRightsRequestConflictError();
    }
    const request = parseRequestRow(existingRow);
    if (
      request.status !== 'completed' ||
      request.receiptDigest !== safe.receiptDigest
    ) {
      throw new DataRightsRequestConflictError();
    }
    return Object.freeze({ kind: 'replayed', request });
  }
}
