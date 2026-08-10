import { createHash } from 'node:crypto';
import type {
  HabitSqlClient,
  HabitSqlQueryResult,
} from './postgres-habit-repository';

/** Must remain byte-for-byte aligned with packages/contracts/src/data-rights.ts. */
export const DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v1' as const;
const CONTRIBUTOR_NAME = 'habit.service' as const;
const EXPORT_SCHEMA_VERSION = 'habit.data-rights.v1' as const;
const EXPORT_PAGE_SIZE = 1_000;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Transaction-capable SQL boundary required by destructive data-rights work. */
export interface HabitTransactionalSqlClient extends HabitSqlClient {
  transaction<T>(operation: (client: HabitSqlClient) => Promise<T>): Promise<T>;
}

/** JSON value emitted by the Habit-owned data-rights contributor. */
export type HabitDataRightsJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly HabitDataRightsJsonValue[]
  | { readonly [key: string]: HabitDataRightsJsonValue };

interface RequestBase {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
}

/** Authorized request accepted by the Habit-owned contributor. */
export type HabitDataRightsRequest = RequestBase &
  (
    | { readonly operation: 'export' }
    | { readonly operation: 'erase_preflight' }
    | { readonly operation: 'erase'; readonly idempotencyKey: string }
    | { readonly operation: 'verify_erased' }
  );

interface ResponseBase {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION;
  readonly contributor: typeof CONTRIBUTOR_NAME;
  readonly requestId: string;
}

/** Successful Habit-owned evidence returned to the Identity orchestrator. */
export type HabitDataRightsResponse = ResponseBase &
  (
    | {
        readonly operation: 'export';
        readonly schemaVersion: typeof EXPORT_SCHEMA_VERSION;
        readonly recordCount: number;
        readonly sha256: string;
        readonly data: HabitDataRightsJsonValue;
      }
    | {
        readonly operation: 'erase_preflight';
        readonly ready: boolean;
        readonly blockers: readonly string[];
      }
    | {
        readonly operation: 'erase';
        readonly erasedRecords: number;
        readonly receiptSha256: string;
      }
    | {
        readonly operation: 'verify_erased';
        readonly erased: boolean;
        readonly evidenceSha256: string;
      }
  );

interface HabitDefinitionExportRow {
  id: unknown;
  title: unknown;
  timezone_name: unknown;
  recurrence_kind: unknown;
  recurrence_interval: unknown;
  weekday_mask: unknown;
  starts_on: unknown;
  created_at: unknown;
}

interface CompletionEventExportRow {
  id: unknown;
  habit_id: unknown;
  scheduled_local_date: unknown;
  completed_at: unknown;
  idempotency_key: unknown;
  recorded_at: unknown;
}

interface PrivilegeRow {
  erasure_receipts_ready: unknown;
  erasure_function_ready: unknown;
}

interface CountRow {
  record_count: unknown;
}

interface ReceiptRow {
  requested_by_user_id: unknown;
  request_id: unknown;
  erased_records: unknown;
  receipt_sha256: unknown;
}

/** Stable credential-free failure for malformed requests or persisted evidence. */
export class HabitDataRightsError extends Error {
  constructor(message = 'Habit data-rights operation failed validation') {
    super(message);
    this.name = 'HabitDataRightsError';
  }
}

function requireUuidV4(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new HabitDataRightsError(`${field} must be a UUIDv4`);
  }
  return value.toLowerCase();
}

function requireString(
  value: unknown,
  field: string,
  maximumLength = 10_000,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    throw new HabitDataRightsError(`${field} is invalid`);
  }
  return value;
}

function requireTimestamp(value: unknown, field: string): string {
  const parsed =
    value instanceof Date ? value : new Date(requireString(value, field));
  if (Number.isNaN(parsed.getTime())) {
    throw new HabitDataRightsError(`${field} is invalid`);
  }
  return parsed.toISOString();
}

function requireDate(value: unknown, field: string): string {
  const candidate =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : requireString(value, field, 10);
  if (!DATE_PATTERN.test(candidate)) {
    throw new HabitDataRightsError(`${field} is invalid`);
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== candidate
  ) {
    throw new HabitDataRightsError(`${field} is invalid`);
  }
  return candidate;
}

function requireInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (
    typeof numeric !== 'number' ||
    !Number.isSafeInteger(numeric) ||
    numeric < minimum ||
    numeric > maximum
  ) {
    throw new HabitDataRightsError(`${field} is invalid`);
  }
  return numeric;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new HabitDataRightsError(`${field} is invalid`);
  }
  return value;
}

function requireSha256(value: unknown): string {
  const candidate = requireString(value, 'sha256', 64).toLowerCase();
  if (!SHA_256_PATTERN.test(candidate)) {
    throw new HabitDataRightsError('sha256 is invalid');
  }
  return candidate;
}

function requireTimezone(value: unknown): string {
  const timezone = requireString(value, 'timezone_name', 255);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(
      new Date(0),
    );
  } catch {
    throw new HabitDataRightsError('timezone_name is invalid');
  }
  return timezone;
}

function canonicalJson(value: HabitDataRightsJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function digest(value: HabitDataRightsJsonValue): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function normalizeRequest(request: HabitDataRightsRequest): {
  readonly request: HabitDataRightsRequest;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
} {
  if (
    !request ||
    request.contractVersion !== DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION
  ) {
    throw new HabitDataRightsError('Contributor contract version is invalid');
  }
  if (
    request.operation !== 'export' &&
    request.operation !== 'erase_preflight' &&
    request.operation !== 'erase' &&
    request.operation !== 'verify_erased'
  ) {
    throw new HabitDataRightsError('Contributor operation is invalid');
  }
  return {
    request,
    workspaceId: requireUuidV4(request.workspaceId, 'workspaceId'),
    requestedByUserId: requireUuidV4(
      request.requestedByUserId,
      'requestedByUserId',
    ),
    requestId: requireUuidV4(request.requestId, 'requestId'),
  };
}

async function collectRows<Row>(
  client: HabitSqlClient,
  query: string,
  workspaceId: string,
): Promise<Row[]> {
  const rows: Row[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.query<Row>(query, [
      workspaceId,
      EXPORT_PAGE_SIZE,
      offset,
    ]);
    rows.push(...page.rows);
    if (page.rows.length < EXPORT_PAGE_SIZE) {
      return rows;
    }
    offset += page.rows.length;
  }
}

function normalizeHabitDefinition(
  row: HabitDefinitionExportRow,
): HabitDataRightsJsonValue {
  const recurrenceKind = requireString(row.recurrence_kind, 'recurrence_kind', 16);
  if (recurrenceKind !== 'daily' && recurrenceKind !== 'weekly') {
    throw new HabitDataRightsError('recurrence_kind is invalid');
  }
  const weekdayMask = requireInteger(row.weekday_mask, 'weekday_mask', 0, 127);
  if (
    (recurrenceKind === 'daily' && weekdayMask !== 0) ||
    (recurrenceKind === 'weekly' && weekdayMask === 0)
  ) {
    throw new HabitDataRightsError('weekday_mask is invalid');
  }
  return Object.freeze({
    id: requireUuidV4(row.id, 'habit_id'),
    title: requireString(row.title, 'title', 160),
    timezoneName: requireTimezone(row.timezone_name),
    recurrenceKind,
    recurrenceInterval: requireInteger(
      row.recurrence_interval,
      'recurrence_interval',
      1,
      365,
    ),
    weekdayMask,
    startsOn: requireDate(row.starts_on, 'starts_on'),
    createdAt: requireTimestamp(row.created_at, 'created_at'),
  });
}

function normalizeCompletionEvent(
  row: CompletionEventExportRow,
): HabitDataRightsJsonValue {
  return Object.freeze({
    id: requireUuidV4(row.id, 'completion_id'),
    habitId: requireUuidV4(row.habit_id, 'habit_id'),
    scheduledLocalDate: requireDate(
      row.scheduled_local_date,
      'scheduled_local_date',
    ),
    completedAt: requireTimestamp(row.completed_at, 'completed_at'),
    idempotencyKey: requireUuidV4(row.idempotency_key, 'idempotency_key'),
    recordedAt: requireTimestamp(row.recorded_at, 'recorded_at'),
  });
}

/** Concrete Habit-owned implementation of life-os.data-rights-contributor.v1. */
export class HabitDataRightsContributor {
  constructor(private readonly client: HabitTransactionalSqlClient) {}

  /** Validates one request before dispatching only to Habit-owned persistence. */
  async handle(
    untrustedRequest: HabitDataRightsRequest,
  ): Promise<HabitDataRightsResponse> {
    const { request, workspaceId, requestedByUserId, requestId } =
      normalizeRequest(untrustedRequest);
    switch (request.operation) {
      case 'export':
        return await this.exportWorkspace(workspaceId, requestId);
      case 'erase_preflight':
        return await this.preflightErase(requestId);
      case 'erase':
        return await this.eraseWorkspace(
          workspaceId,
          requestedByUserId,
          requestId,
          requireUuidV4(request.idempotencyKey, 'idempotencyKey'),
        );
      case 'verify_erased':
        return await this.verifyWorkspaceErased(workspaceId, requestId);
    }
  }

  private async exportWorkspace(
    workspaceId: string,
    requestId: string,
  ): Promise<HabitDataRightsResponse> {
    return await this.client.transaction(async (transaction) => {
      await transaction.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
        [],
      );
      const habits = await collectRows<HabitDefinitionExportRow>(
        transaction,
        `SELECT id, title, timezone_name, recurrence_kind,
                recurrence_interval, weekday_mask, starts_on, created_at
         FROM habit.habit_definitions
         WHERE workspace_id = $1
         ORDER BY created_at ASC, id ASC
         LIMIT $2 OFFSET $3`,
        workspaceId,
      );
      const completions = await collectRows<CompletionEventExportRow>(
        transaction,
        `SELECT id, habit_id, scheduled_local_date, completed_at,
                idempotency_key, recorded_at
         FROM habit.completion_events
         WHERE workspace_id = $1
         ORDER BY recorded_at ASC, id ASC
         LIMIT $2 OFFSET $3`,
        workspaceId,
      );
      const data = Object.freeze({
        habits: Object.freeze(habits.map(normalizeHabitDefinition)),
        completionEvents: Object.freeze(completions.map(normalizeCompletionEvent)),
      });
      return {
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'export',
        contributor: CONTRIBUTOR_NAME,
        requestId,
        schemaVersion: EXPORT_SCHEMA_VERSION,
        recordCount: habits.length + completions.length,
        sha256: digest(data),
        data,
      };
    });
  }

  private async readPrivileges(client: HabitSqlClient): Promise<{
    readonly receiptsReady: boolean;
    readonly functionReady: boolean;
  }> {
    const result = await client.query<PrivilegeRow>(
      `SELECT
         COALESCE(
           has_table_privilege(
             current_user,
             to_regclass('habit.data_rights_erasure_receipts'),
             'SELECT,INSERT'
           ),
           false
         ) AS erasure_receipts_ready,
         COALESCE(
           has_function_privilege(
             current_user,
             to_regprocedure('habit.erase_workspace_data(uuid)'),
             'EXECUTE'
           ),
           false
         ) AS erasure_function_ready`,
      [],
    );
    const row = result.rows[0];
    return {
      receiptsReady: requireBoolean(
        row?.erasure_receipts_ready,
        'erasure_receipts_ready',
      ),
      functionReady: requireBoolean(
        row?.erasure_function_ready,
        'erasure_function_ready',
      ),
    };
  }

  private async preflightErase(
    requestId: string,
  ): Promise<HabitDataRightsResponse> {
    const privileges = await this.readPrivileges(this.client);
    const blockers: string[] = [];
    if (!privileges.receiptsReady) {
      blockers.push('habit_erasure_receipt_privileges_unavailable');
    }
    if (!privileges.functionReady) {
      blockers.push('habit_erasure_function_unavailable');
    }
    return {
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'erase_preflight',
      contributor: CONTRIBUTOR_NAME,
      requestId,
      ready: blockers.length === 0,
      blockers: Object.freeze(blockers),
    };
  }

  private async eraseWorkspace(
    workspaceId: string,
    requestedByUserId: string,
    requestId: string,
    idempotencyKey: string,
  ): Promise<HabitDataRightsResponse> {
    return await this.client.transaction(async (transaction) => {
      const privileges = await this.readPrivileges(transaction);
      if (!privileges.receiptsReady || !privileges.functionReady) {
        throw new HabitDataRightsError('Habit erasure authority is unavailable');
      }

      await transaction.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended($1::text, 0)
         )`,
        [`${CONTRIBUTOR_NAME}:${workspaceId}:${idempotencyKey}`],
      );

      const existing = await transaction.query<ReceiptRow>(
        `SELECT requested_by_user_id, request_id, erased_records, receipt_sha256
         FROM habit.data_rights_erasure_receipts
         WHERE workspace_id = $1 AND idempotency_key = $2`,
        [workspaceId, idempotencyKey],
      );
      if (existing.rows.length > 0) {
        const receipt = existing.rows[0];
        if (
          requireUuidV4(receipt?.requested_by_user_id, 'requested_by_user_id') !==
            requestedByUserId ||
          requireUuidV4(receipt?.request_id, 'request_id') !== requestId
        ) {
          throw new HabitDataRightsError('Habit erasure replay identity conflicts');
        }
        return {
          contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
          operation: 'erase',
          contributor: CONTRIBUTOR_NAME,
          requestId,
          erasedRecords: requireInteger(
            receipt?.erased_records,
            'erased_records',
            0,
          ),
          receiptSha256: requireSha256(receipt?.receipt_sha256),
        };
      }

      const erased = await transaction.query<CountRow>(
        `SELECT habit.erase_workspace_data($1::uuid) AS record_count`,
        [workspaceId],
      );
      const erasedRecords = requireInteger(
        erased.rows[0]?.record_count,
        'record_count',
        0,
      );
      const receiptEvidence = Object.freeze({
        contributor: CONTRIBUTOR_NAME,
        workspaceId,
        idempotencyKey,
        requestId,
        requestedByUserId,
        erasedRecords,
      });
      const receiptSha256 = digest(receiptEvidence);
      await transaction.query(
        `INSERT INTO habit.data_rights_erasure_receipts (
           workspace_id,
           idempotency_key,
           request_id,
           requested_by_user_id,
           erased_records,
           receipt_sha256,
           erased_at
         ) VALUES ($1, $2, $3, $4, $5, $6, transaction_timestamp())`,
        [
          workspaceId,
          idempotencyKey,
          requestId,
          requestedByUserId,
          erasedRecords,
          receiptSha256,
        ],
      );
      return {
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'erase',
        contributor: CONTRIBUTOR_NAME,
        requestId,
        erasedRecords,
        receiptSha256,
      };
    });
  }

  private async verifyWorkspaceErased(
    workspaceId: string,
    requestId: string,
  ): Promise<HabitDataRightsResponse> {
    const result = await this.client.query<CountRow>(
      `SELECT (
         (SELECT count(*) FROM habit.habit_definitions WHERE workspace_id = $1) +
         (SELECT count(*) FROM habit.completion_events WHERE workspace_id = $1)
       )::integer AS record_count`,
      [workspaceId],
    );
    const liveRecords = requireInteger(
      result.rows[0]?.record_count,
      'record_count',
      0,
    );
    const evidenceSha256 = digest(
      Object.freeze({ contributor: CONTRIBUTOR_NAME, workspaceId, liveRecords }),
    );
    return {
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'verify_erased',
      contributor: CONTRIBUTOR_NAME,
      requestId,
      erased: liveRecords === 0,
      evidenceSha256,
    };
  }
}
