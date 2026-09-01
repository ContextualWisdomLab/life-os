import { createHash } from 'node:crypto';
import type {
  NotificationSqlClient,
  NotificationSqlQueryResult,
} from './postgres-reminder-repository';

export const NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v1' as const;
const CONTRIBUTOR_NAME = 'notification.service' as const;
const EXPORT_SCHEMA_VERSION = 'notification.data-rights.v1' as const;
const EXPORT_CURSOR_VERSION = 'notification.data-rights.cursor.v1' as const;
const MAX_EXPORT_RECORDS = 1_000;
const MAX_EXPORT_CURSOR_BYTES = 512;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_CONTAINER_ITEMS = 2_000;
const MAX_JSON_STRING_BYTES = 64 * 1024;
const MAX_JSON_KEY_BYTES = 256;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/u;

/** JSON-safe value returned by the Notification-owned contributor. */
export type NotificationDataRightsJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly NotificationDataRightsJsonValue[]
  | { readonly [key: string]: NotificationDataRightsJsonValue };

/** Shared validated authority fields carried by every Notification data-rights request. */
interface NotificationDataRightsRequestBase {
  readonly contractVersion: typeof NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
}

/** Versioned request accepted by the Notification-owned contributor. */
export type NotificationDataRightsRequest =
  | Readonly<
      NotificationDataRightsRequestBase & {
        readonly operation: 'export';
        readonly cursor?: string;
      }
    >
  | Readonly<
      NotificationDataRightsRequestBase & {
        readonly operation: 'erase_preflight' | 'verify_erased';
      }
    >
  | Readonly<
      NotificationDataRightsRequestBase & {
        readonly operation: 'erase';
        readonly idempotencyKey: string;
      }
    >;

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
      nextCursor?: string;
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

/** Stable ordering discriminator for exported Notification evidence. */
type EvidenceKind =
  | 'inbox_message'
  | 'reminder_occurrence'
  | 'reminder_outcome';

/** Opaque keyset position for the next deterministic export page. */
interface ExportCursor {
  readonly evidenceTime: string;
  readonly evidenceKind: EvidenceKind;
  readonly evidenceId: string;
}

/** Canonical request after every untrusted field is validated. */
type NormalizedRequest =
  | (NormalizedRequestBase & {
      readonly operation: 'export';
      readonly cursor: ExportCursor | undefined;
    })
  | (NormalizedRequestBase & {
      readonly operation: 'erase_preflight' | 'verify_erased';
    })
  | (NormalizedRequestBase & {
      readonly operation: 'erase';
      readonly idempotencyKey: string;
    });

/** Aggregate row returned by the bounded one-statement export query. */
interface ExportRow {
  evidence_records: unknown;
}

/** Untrusted wrapper returned by the cross-table export query. */
interface ExportEvidenceRecord {
  readonly evidenceTime: string;
  readonly evidenceKind: EvidenceKind;
  readonly evidenceId: string;
  readonly data: NotificationDataRightsJsonValue;
}

/** Privilege evidence required before destructive Notification erasure. */
interface PrivilegeRow {
  erasure_function_ready: unknown;
  replay_select_ready: unknown;
  replay_insert_ready: unknown;
  replay_delete_ready: unknown;
  notification_schema_usage_ready: unknown;
  reminder_occurrences_select_ready: unknown;
  reminder_outcomes_select_ready: unknown;
  inbox_messages_select_ready: unknown;
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

/** Compares canonical object keys by UTF-16 code units without locale collation. */
function compareCanonicalKeys(left: string, right: string): number {
  return Number(left > right) - Number(left < right);
}

/** Requires one real UTC calendar instant suitable for PostgreSQL keyset comparison. */
function requireIsoInstant(value: unknown): string {
  if (typeof value !== 'string') {
    return invalidDataRights();
  }
  if (!ISO_INSTANT_PATTERN.test(value)) {
    return invalidDataRights();
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));
  const normalized = new Date(0);
  normalized.setUTCFullYear(year, month - 1, day);
  normalized.setUTCHours(hour, minute, second, 0);
  if (
    normalized.getUTCFullYear() !== year ||
    normalized.getUTCMonth() !== month - 1 ||
    normalized.getUTCDate() !== day ||
    normalized.getUTCHours() !== hour ||
    normalized.getUTCMinutes() !== minute ||
    normalized.getUTCSeconds() !== second
  ) {
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
    entries.sort(([left], [right]) => compareCanonicalKeys(left, right));
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

/** Computes deterministic SHA-256 evidence over canonical bounded JSON. */
function digest(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
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

/** Decodes and validates one bounded opaque export cursor. */
function decodeExportCursor(value: unknown): ExportCursor {
  if (typeof value !== 'string') {
    return invalidDataRights();
  }
  if (value.length === 0 || value.length > MAX_EXPORT_CURSOR_BYTES) {
    return invalidDataRights();
  }
  if (!BASE64URL_PATTERN.test(value)) {
    return invalidDataRights();
  }
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  let untrusted: unknown;
  try {
    untrusted = JSON.parse(decoded);
  } catch {
    return invalidDataRights();
  }
  const record = requireRecord(untrusted);
  requireExactKeys(record, [
    'version',
    'evidenceTime',
    'evidenceKind',
    'evidenceId',
  ]);
  if (record.version !== EXPORT_CURSOR_VERSION) {
    return invalidDataRights();
  }
  if (
    record.evidenceKind !== 'inbox_message' &&
    record.evidenceKind !== 'reminder_occurrence' &&
    record.evidenceKind !== 'reminder_outcome'
  ) {
    return invalidDataRights();
  }
  return Object.freeze({
    evidenceTime: requireIsoInstant(record.evidenceTime),
    evidenceKind: record.evidenceKind,
    evidenceId: requireUuidV4(record.evidenceId),
  });
}

/** Encodes one validated keyset position as an opaque cursor. */
function encodeExportCursor(cursor: ExportCursor): string {
  const serialized = canonicalJson({
    version: EXPORT_CURSOR_VERSION,
    evidenceTime: cursor.evidenceTime,
    evidenceKind: cursor.evidenceKind,
    evidenceId: cursor.evidenceId,
  });
  return Buffer.from(serialized, 'utf8').toString('base64url');
}

/** Validates one cross-table export row before it reaches portability output. */
function requireExportEvidenceRecord(value: unknown): ExportEvidenceRecord {
  const record = requireRecord(value);
  requireExactKeys(record, [
    'evidenceTime',
    'evidenceKind',
    'evidenceId',
    'data',
  ]);
  if (
    record.evidenceKind !== 'inbox_message' &&
    record.evidenceKind !== 'reminder_occurrence' &&
    record.evidenceKind !== 'reminder_outcome'
  ) {
    return invalidDataRights();
  }
  return Object.freeze({
    evidenceTime: requireIsoInstant(record.evidenceTime),
    evidenceKind: record.evidenceKind,
    evidenceId: requireUuidV4(record.evidenceId),
    data: record.data as NotificationDataRightsJsonValue,
  });
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
  if (operation === 'export') {
    const hasCursor = Object.prototype.hasOwnProperty.call(record, 'cursor');
    requireExactKeys(record, hasCursor ? [...baseKeys, 'cursor'] : baseKeys);
    return {
      operation,
      workspaceId: requireUuidV4(record.workspaceId),
      requestedByUserId: requireUuidV4(record.requestedByUserId),
      requestId: requireUuidV4(record.requestId),
      cursor: hasCursor ? decodeExportCursor(record.cursor) : undefined,
    };
  }
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
        return await this.exportWorkspace(
          request.workspaceId,
          request.requestId,
          request.cursor,
        );
      case 'erase_preflight':
        return await this.preflightErase(request.requestId);
      case 'erase':
        return await this.eraseWorkspace(request);
      case 'verify_erased':
        return await this.verifyErased(request.workspaceId, request.requestId);
    }
  }

  /** Exports one deterministic bounded page of tenant-scoped Notification evidence. */
  private async exportWorkspace(
    workspaceId: string,
    requestId: string,
    cursor: ExportCursor | undefined,
  ): Promise<NotificationDataRightsResponse> {
    const row = exactlyOne(
      await this.query<ExportRow>(
        `WITH candidate_evidence AS (
           SELECT
             created_at AS evidence_time,
             'reminder_occurrence'::text AS evidence_kind,
             reminder_id AS evidence_id,
             jsonb_build_object(
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
             ) AS evidence_data
           FROM notification_service.reminder_occurrences
           WHERE workspace_id = $1
             AND (
               $2::timestamptz IS NULL
               OR (created_at, 'reminder_occurrence'::text, reminder_id) >
                  ($2::timestamptz, $3::text, $4::uuid)
             )
           UNION ALL
           SELECT
             occurred_at AS evidence_time,
             'reminder_outcome'::text AS evidence_kind,
             outcome_id AS evidence_id,
             jsonb_build_object(
               'outcomeId', outcome_id,
               'reminderId', reminder_id,
               'kind', outcome_kind,
               'occurredAt', to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'nextAttemptAt', CASE WHEN next_attempt_at IS NULL THEN NULL ELSE to_char(next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
               'reason', outcome_reason,
               'deliveryLocalDate', delivery_local_date,
               'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) AS evidence_data
           FROM notification_service.reminder_outcomes
           WHERE workspace_id = $1
             AND (
               $2::timestamptz IS NULL
               OR (occurred_at, 'reminder_outcome'::text, outcome_id) >
                  ($2::timestamptz, $3::text, $4::uuid)
             )
           UNION ALL
           SELECT
             delivered_at AS evidence_time,
             'inbox_message'::text AS evidence_kind,
             message_id AS evidence_id,
             jsonb_build_object(
               'messageId', message_id,
               'reminderId', reminder_id,
               'title', message_title,
               'dueAt', to_char(due_instant AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'timeZone', time_zone,
               'deliveredAt', to_char(delivered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'readAt', CASE WHEN read_at IS NULL THEN NULL ELSE to_char(read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END,
               'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'updatedAt', to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) AS evidence_data
           FROM notification_service.inbox_messages
           WHERE workspace_id = $1
             AND (
               $2::timestamptz IS NULL
               OR (delivered_at, 'inbox_message'::text, message_id) >
                  ($2::timestamptz, $3::text, $4::uuid)
             )
         ), bounded_evidence AS (
           SELECT evidence_time, evidence_kind, evidence_id, evidence_data
           FROM candidate_evidence
           ORDER BY evidence_time ASC, evidence_kind ASC, evidence_id ASC
           LIMIT $5
         )
         SELECT COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'evidenceTime', to_char(
                 evidence_time AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
               ),
               'evidenceKind', evidence_kind,
               'evidenceId', evidence_id,
               'data', evidence_data
             )
             ORDER BY evidence_time ASC, evidence_kind ASC, evidence_id ASC
           ),
           '[]'::jsonb
         ) AS evidence_records
         FROM bounded_evidence`,
        [
          workspaceId,
          cursor?.evidenceTime ?? null,
          cursor?.evidenceKind ?? null,
          cursor?.evidenceId ?? null,
          MAX_EXPORT_RECORDS + 1,
        ],
      ),
    );
    if (!Array.isArray(row.evidence_records)) {
      return invalidDataRights();
    }
    if (row.evidence_records.length > MAX_EXPORT_RECORDS + 1) {
      return invalidDataRights();
    }

    const page = Array.from(
      row.evidence_records.slice(0, MAX_EXPORT_RECORDS),
      (record) => requireExportEvidenceRecord(record),
    );
    const reminderOccurrences: NotificationDataRightsJsonValue[] = [];
    const reminderOutcomes: NotificationDataRightsJsonValue[] = [];
    const inboxMessages: NotificationDataRightsJsonValue[] = [];
    for (const record of page) {
      if (record.evidenceKind === 'reminder_occurrence') {
        reminderOccurrences.push(record.data);
      } else if (record.evidenceKind === 'reminder_outcome') {
        reminderOutcomes.push(record.data);
      } else {
        inboxMessages.push(record.data);
      }
    }
    const data = Object.freeze({
      reminderOccurrences: Object.freeze(reminderOccurrences),
      reminderOutcomes: Object.freeze(reminderOutcomes),
      inboxMessages: Object.freeze(inboxMessages),
    });
    const hasMore = row.evidence_records.length > MAX_EXPORT_RECORDS;
    const nextCursor = hasMore
      ? encodeExportCursor(page[MAX_EXPORT_RECORDS - 1] as ExportEvidenceRecord)
      : undefined;
    const sha256 = digest(data);

    return {
      contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'export',
      requestId,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      recordCount: page.length,
      sha256,
      data,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  /** Verifies every database privilege consumed by the authenticated destructive erase path. */
  private async preflightErase(
    requestId: string,
  ): Promise<NotificationDataRightsResponse> {
    const row = exactlyOne(
      await this.query<PrivilegeRow>(
        `SELECT
           COALESCE(has_function_privilege(
             current_user,
             to_regprocedure('notification_service.erase_workspace_data(uuid,uuid,uuid,uuid)'),
             'EXECUTE'
           ), false) AS erasure_function_ready,
           COALESCE(has_table_privilege(
             current_user,
             to_regclass('notification_service.data_rights_authority_replay_records'),
             'SELECT'
           ), false) AS replay_select_ready,
           COALESCE(has_table_privilege(
             current_user,
             to_regclass('notification_service.data_rights_authority_replay_records'),
             'INSERT'
           ), false) AS replay_insert_ready,
           COALESCE(has_table_privilege(
             current_user,
             to_regclass('notification_service.data_rights_authority_replay_records'),
             'DELETE'
           ), false) AS replay_delete_ready,
           COALESCE(has_schema_privilege(
             current_user,
             to_regnamespace('notification_service'),
             'USAGE'
           ), false) AS notification_schema_usage_ready,
           COALESCE(has_table_privilege(
             current_user,
             to_regclass('notification_service.reminder_occurrences'),
             'SELECT'
           ), false) AS reminder_occurrences_select_ready,
           COALESCE(has_table_privilege(
             current_user,
             to_regclass('notification_service.reminder_outcomes'),
             'SELECT'
           ), false) AS reminder_outcomes_select_ready,
           COALESCE(has_table_privilege(
             current_user,
             to_regclass('notification_service.inbox_messages'),
             'SELECT'
           ), false) AS inbox_messages_select_ready`,
        [],
      ),
    );
    const functionReady = requireBoolean(row.erasure_function_ready);
    const replaySelectReady = requireBoolean(row.replay_select_ready);
    const replayInsertReady = requireBoolean(row.replay_insert_ready);
    const replayDeleteReady = requireBoolean(row.replay_delete_ready);
    const notificationSchemaUsageReady = requireBoolean(
      row.notification_schema_usage_ready,
    );
    const reminderOccurrencesSelectReady = requireBoolean(
      row.reminder_occurrences_select_ready,
    );
    const reminderOutcomesSelectReady = requireBoolean(
      row.reminder_outcomes_select_ready,
    );
    const inboxMessagesSelectReady = requireBoolean(
      row.inbox_messages_select_ready,
    );
    const blockers: string[] = [];
    if (!functionReady) {
      blockers.push('notification_erasure_function_unavailable');
    }
    if (!replaySelectReady || !replayInsertReady || !replayDeleteReady) {
      blockers.push('notification_data_rights_replay_store_unavailable');
    }
    if (
      !notificationSchemaUsageReady ||
      !reminderOccurrencesSelectReady ||
      !reminderOutcomesSelectReady ||
      !inboxMessagesSelectReady
    ) {
      blockers.push('notification_erasure_verification_unavailable');
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
