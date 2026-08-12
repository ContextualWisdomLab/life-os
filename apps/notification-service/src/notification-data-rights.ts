import { createHash } from 'node:crypto';
import type {
  NotificationSqlClient,
  NotificationSqlQueryResult,
} from './postgres-reminder-repository';

export const NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v1' as const;
const CONTRIBUTOR_NAME = 'notification.service' as const;
const EXPORT_SCHEMA_VERSION = 'notification.data-rights.v1' as const;
const MAX_EXPORT_RECORDS = 1_000;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_CONTAINER_ITEMS = 2_000;
const MAX_JSON_STRING_BYTES = 64 * 1024;
const MAX_JSON_KEY_BYTES = 256;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

/** JSON-safe value returned by the Notification-owned contributor. */
export type NotificationDataRightsJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly NotificationDataRightsJsonValue[]
  | { readonly [key: string]: NotificationDataRightsJsonValue };

/** Versioned request accepted by the Notification-owned contributor. */
export type NotificationDataRightsRequest = Readonly<{
  contractVersion: typeof NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION;
  operation: 'export' | 'erase_preflight' | 'erase' | 'verify_erased';
  workspaceId: string;
  requestedByUserId: string;
  requestId: string;
  idempotencyKey?: string;
}>;

/** Successful response emitted by the Notification-owned contributor. */
export type NotificationDataRightsResponse =
  | Readonly<{
      contractVersion: typeof NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION;
      contributor: typeof CONTRIBUTOR_NAME;
      operation: 'export';
      requestId: string;
      schemaVersion: typeof EXPORT_SCHEMA_VERSION;
      recordCount: number;
      sha256: string;
      data: NotificationDataRightsJsonValue;
    }>
  | Readonly<{
      contractVersion: typeof NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION;
      contributor: typeof CONTRIBUTOR_NAME;
      operation: 'erase_preflight';
      requestId: string;
      ready: boolean;
      blockers: readonly string[];
    }>
  | Readonly<{
      contractVersion: typeof NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION;
      contributor: typeof CONTRIBUTOR_NAME;
      operation: 'erase';
      requestId: string;
      erasedRecords: number;
      receiptSha256: string;
    }>
  | Readonly<{
      contractVersion: typeof NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION;
      contributor: typeof CONTRIBUTOR_NAME;
      operation: 'verify_erased';
      requestId: string;
      erased: boolean;
      evidenceSha256: string;
    }>;

/** Common validated fields carried by every normalized contributor request. */
interface NormalizedRequestBase {
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
}

/** Canonical request after every untrusted field is validated. */
type NormalizedRequest =
  | (NormalizedRequestBase & {
      readonly operation: 'export' | 'erase_preflight' | 'verify_erased';
    })
  | (NormalizedRequestBase & {
      readonly operation: 'erase';
      readonly idempotencyKey: string;
    });

/** Aggregate row returned by the bounded one-statement export query. */
interface ExportRow {
  reminder_occurrences: unknown;
  reminder_outcomes: unknown;
  inbox_messages: unknown;
}

/** Privilege evidence required before destructive Notification erasure. */
interface PrivilegeRow {
  erasure_function_ready: unknown;
}

/** Aggregate count returned by post-erasure verification. */
interface CountRow {
  record_count: unknown;
}

/** Atomic PostgreSQL erasure result returned by the owner-controlled function. */
interface EraseRow {
  erased_records: unknown;
  receipt_sha256: unknown;
}

/** Stable credential-free failure for malformed requests, evidence, or persistence. */
export class NotificationDataRightsError extends Error {
  /** Creates one bounded public data-rights failure. */
  constructor() {
    super('Notification data-rights operation failed');
    this.name = 'NotificationDataRightsError';
  }
}

/** Raises the stable contributor failure without retaining untrusted details. */
function invalidDataRights(): never {
  throw new NotificationDataRightsError();
}

/** Requires a plain JSON object at the request boundary. */
function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object') {
    return invalidDataRights();
  }
  if (value === null) {
    return invalidDataRights();
  }
  if (Array.isArray(value)) {
    return invalidDataRights();
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return invalidDataRights();
  }
  return value as Record<string, unknown>;
}

/** Requires exactly the documented operation-specific request field set. */
function requireExactKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(record).sort();
  const canonicalExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(canonicalExpected)) {
    invalidDataRights();
  }
}

/** Validates and canonicalizes one opaque UUIDv4 identifier. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string') {
    return invalidDataRights();
  }
  if (!UUID_V4_PATTERN.test(value)) {
    return invalidDataRights();
  }
  return value.toLowerCase();
}

/** Requires one non-negative safe PostgreSQL integer. */
function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number') {
    return invalidDataRights();
  }
  if (!Number.isSafeInteger(value)) {
    return invalidDataRights();
  }
  if (value < 0) {
    return invalidDataRights();
  }
  return value;
}

/** Requires one PostgreSQL boolean without truthy coercion. */
function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    return invalidDataRights();
  }
  return value;
}

/** Requires a canonical lower-case SHA-256 hex digest. */
function requireSha256(value: unknown): string {
  if (typeof value !== 'string') {
    return invalidDataRights();
  }
  if (!SHA_256_PATTERN.test(value)) {
    return invalidDataRights();
  }
  return value;
}

/** Converts untrusted JSON evidence to deterministic canonical JSON while enforcing bounds. */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_JSON_DEPTH) {
    return invalidDataRights();
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return invalidDataRights();
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_JSON_STRING_BYTES) {
      return invalidDataRights();
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_CONTAINER_ITEMS) {
      return invalidDataRights();
    }
    return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidDataRights();
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_JSON_CONTAINER_ITEMS) {
      return invalidDataRights();
    }
    entries.sort(([left], [right]) => {
      if (left < right) {
        return -1;
      }
      if (left > right) {
        return 1;
      }
      return 0;
    });
    const serialized = entries.map(([key, entry]) => {
      if (Buffer.byteLength(key, 'utf8') > MAX_JSON_KEY_BYTES) {
        return invalidDataRights();
      }
      return `${JSON.stringify(key)}:${canonicalJson(entry, depth + 1)}`;
    });
    return `{${serialized.join(',')}}`;
  }
  return invalidDataRights();
}

/** Validates one JSON-safe value and returns the same value with a narrowed type. */
function requireJsonValue(value: unknown): NotificationDataRightsJsonValue {
  canonicalJson(value);
  return value as NotificationDataRightsJsonValue;
}

/** Computes deterministic SHA-256 evidence over canonical bounded JSON. */
function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Requires exactly one PostgreSQL row and rejects missing or duplicate evidence. */
function exactlyOne<Row>(result: NotificationSqlQueryResult<Row>): Row {
  if (result.rows.length !== 1) {
    return invalidDataRights();
  }
  const row = result.rows[0];
  if (row === undefined) {
    return invalidDataRights();
  }
  return row;
}

/** Validates the exact v1 request shape before any Notification persistence access. */
function normalizeRequest(untrusted: unknown): NormalizedRequest {
  const record = requireRecord(untrusted);
  if (record.contractVersion !== NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION) {
    return invalidDataRights();
  }
  const operation = record.operation;
  if (
    operation !== 'export' &&
    operation !== 'erase_preflight' &&
    operation !== 'erase' &&
    operation !== 'verify_erased'
  ) {
    return invalidDataRights();
  }
  const baseKeys = [
    'contractVersion',
    'operation',
    'workspaceId',
    'requestedByUserId',
    'requestId',
  ];
  requireExactKeys(
    record,
    operation === 'erase' ? [...baseKeys, 'idempotencyKey'] : baseKeys,
  );
  const base = {
    workspaceId: requireUuidV4(record.workspaceId),
    requestedByUserId: requireUuidV4(record.requestedByUserId),
    requestId: requireUuidV4(record.requestId),
  };
  if (operation === 'erase') {
    return {
      ...base,
      operation,
      idempotencyKey: requireUuidV4(record.idempotencyKey),
    };
  }
  return { ...base, operation };
}

/** Service-owned implementation of the versioned LifeOS data-rights contributor lifecycle. */
export class NotificationDataRightsContributor {
  /** Creates the contributor over the Notification service's own SQL boundary. */
  constructor(private readonly client: NotificationSqlClient) {}

  /** Executes SQL while replacing database details with one credential-free failure. */
  private async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      throw new NotificationDataRightsError();
    }
  }

  /** Validates and dispatches one internal contributor request. */
  async handle(
    untrustedRequest: unknown,
  ): Promise<NotificationDataRightsResponse> {
    const request = normalizeRequest(untrustedRequest);
    switch (request.operation) {
      case 'export':
        return await this.exportWorkspace(request.workspaceId, request.requestId);
      case 'erase_preflight':
        return await this.preflightErase(request.requestId);
      case 'erase':
        return await this.eraseWorkspace(request);
      case 'verify_erased':
        return await this.verifyErased(request.workspaceId, request.requestId);
    }
  }

  /** Exports one deterministic, bounded, tenant-scoped Notification section. */
  private async exportWorkspace(
    workspaceId: string,
    requestId: string,
  ): Promise<NotificationDataRightsResponse> {
    const row = exactlyOne(
      await this.query<ExportRow>(
        `SELECT
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'reminderId', reminder_id,
               'title', reminder_title,
               'dueAt', to_char(due_instant AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'timeZone', time_zone,
               'quietStartMinute', quiet_start_minute,
               'quietEndMinute', quiet_end_minute,
               'dailyDeliveryLimit', daily_delivery_limit,
               'deliveryAttemptCount', delivery_attempt_count,
               'status', occurrence_status,
               'claimExpiresAt', CASE WHEN claim_expires_at IS NULL THEN NULL ELSE to_char(claim_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
               'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) ORDER BY created_at ASC, reminder_id ASC)
             FROM (
               SELECT * FROM notification_service.reminder_occurrences
               WHERE workspace_id = $1
               ORDER BY created_at ASC, reminder_id ASC
               LIMIT $2
             ) AS bounded_occurrences
           ), '[]'::jsonb) AS reminder_occurrences,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'outcomeId', outcome_id,
               'reminderId', reminder_id,
               'kind', outcome_kind,
               'occurredAt', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'nextAttemptAt', CASE WHEN next_attempt_at IS NULL THEN NULL ELSE to_char(next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
               'reason', outcome_reason,
               'deliveryLocalDate', delivery_local_date,
               'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) ORDER BY occurred_at ASC, outcome_id ASC)
             FROM (
               SELECT * FROM notification_service.reminder_outcomes
               WHERE workspace_id = $1
               ORDER BY occurred_at ASC, outcome_id ASC
               LIMIT $2
             ) AS bounded_outcomes
           ), '[]'::jsonb) AS reminder_outcomes,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'messageId', message_id,
               'reminderId', reminder_id,
               'title', message_title,
               'dueAt', to_char(due_instant AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'timeZone', time_zone,
               'deliveredAt', to_char(delivered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'readAt', CASE WHEN read_at IS NULL THEN NULL ELSE to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
               'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) ORDER BY delivered_at ASC, message_id ASC)
             FROM (
               SELECT * FROM notification_service.inbox_messages
               WHERE workspace_id = $1
               ORDER BY delivered_at ASC, message_id ASC
               LIMIT $2
             ) AS bounded_messages
           ), '[]'::jsonb) AS inbox_messages`,
        [workspaceId, MAX_EXPORT_RECORDS + 1],
      ),
    );
    if (!Array.isArray(row.reminder_occurrences)) {
      return invalidDataRights();
    }
    if (!Array.isArray(row.reminder_outcomes)) {
      return invalidDataRights();
    }
    if (!Array.isArray(row.inbox_messages)) {
      return invalidDataRights();
    }
    const recordCount =
      row.reminder_occurrences.length +
      row.reminder_outcomes.length +
      row.inbox_messages.length;
    if (recordCount > MAX_EXPORT_RECORDS) {
      return invalidDataRights();
    }
    const data = Object.freeze({
      reminderOccurrences: requireJsonValue(row.reminder_occurrences),
      reminderOutcomes: requireJsonValue(row.reminder_outcomes),
      inboxMessages: requireJsonValue(row.inbox_messages),
    });
    return {
      contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'export',
      requestId,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      recordCount,
      sha256: digest(data),
      data,
    };
  }

  /** Checks owner-controlled erasure function authority without requiring direct receipt-table access. */
  private async preflightErase(
    requestId: string,
  ): Promise<NotificationDataRightsResponse> {
    const row = exactlyOne(
      await this.query<PrivilegeRow>(
        `SELECT COALESCE(has_function_privilege(
           current_user,
           to_regprocedure('notification_service.erase_workspace_data(uuid,uuid,uuid,uuid)'),
           'EXECUTE'
         ), false) AS erasure_function_ready`,
        [],
      ),
    );
    const functionReady = requireBoolean(row.erasure_function_ready);
    const blockers: string[] = [];
    if (!functionReady) {
      blockers.push('notification_erasure_function_unavailable');
    }
    return {
      contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'erase_preflight',
      requestId,
      ready: blockers.length === 0,
      blockers: Object.freeze(blockers),
    };
  }

  /** Executes one atomic, replay-safe Notification-owned erasure. */
  private async eraseWorkspace(
    request: Extract<NormalizedRequest, { readonly operation: 'erase' }>,
  ): Promise<NotificationDataRightsResponse> {
    const row = exactlyOne(
      await this.query<EraseRow>(
        `SELECT
           result_erased_records AS erased_records,
           result_receipt_sha256 AS receipt_sha256
         FROM notification_service.erase_workspace_data($1, $2, $3, $4)`,
        [
          request.workspaceId,
          request.requestedByUserId,
          request.requestId,
          request.idempotencyKey,
        ],
      ),
    );
    return {
      contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'erase',
      requestId: request.requestId,
      erasedRecords: requireNonNegativeInteger(row.erased_records),
      receiptSha256: requireSha256(row.receipt_sha256),
    };
  }

  /** Verifies that no live Notification-owned tenant records remain. */
  private async verifyErased(
    workspaceId: string,
    requestId: string,
  ): Promise<NotificationDataRightsResponse> {
    const row = exactlyOne(
      await this.query<CountRow>(
        `SELECT (
           (SELECT count(*) FROM notification_service.reminder_occurrences WHERE workspace_id = $1) +
           (SELECT count(*) FROM notification_service.reminder_outcomes WHERE workspace_id = $1) +
           (SELECT count(*) FROM notification_service.inbox_messages WHERE workspace_id = $1)
         )::integer AS record_count`,
        [workspaceId],
      ),
    );
    const liveRecords = requireNonNegativeInteger(row.record_count);
    return {
      contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'verify_erased',
      requestId,
      erased: liveRecords === 0,
      evidenceSha256: digest({
        contributor: CONTRIBUTOR_NAME,
        workspaceId,
        liveRecords,
      }),
    };
  }
}
