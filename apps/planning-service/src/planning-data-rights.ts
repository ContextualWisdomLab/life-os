import { createHash } from 'node:crypto';
import type {
  PlanningSqlClient,
  PlanningSqlQueryResult,
} from './postgres-planning-repository';
import type { TodayTransactionalSqlClient } from './postgres-today-repository';

/** Must remain byte-for-byte aligned with packages/contracts/src/data-rights.ts. */
export const DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v1' as const;
const CONTRIBUTOR_NAME = 'planning.service' as const;
const EXPORT_SCHEMA_VERSION = 'planning.data-rights.v1' as const;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const MAXIMUM_JSON_DEPTH = 20;
const MAXIMUM_ARRAY_ITEMS = 10_000;
const MAXIMUM_OBJECT_KEYS = 10_000;
const MAXIMUM_STRING_LENGTH = 100_000;

export type DataRightsJsonPrimitive = boolean | number | string | null;
export interface DataRightsJsonArray extends ReadonlyArray<DataRightsJsonValue> {}
export interface DataRightsJsonObject {
  readonly [key: string]: DataRightsJsonValue;
}
export type DataRightsJsonValue =
  | DataRightsJsonPrimitive
  | DataRightsJsonArray
  | DataRightsJsonObject;

interface ContributorRequestBase {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
}

export type DataRightsContributorRequest = ContributorRequestBase &
  (
    | { readonly operation: 'export' }
    | { readonly operation: 'erase_preflight' }
    | { readonly operation: 'erase'; readonly idempotencyKey: string }
    | { readonly operation: 'verify_erased' }
  );

interface ContributorResponseBase {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION;
  readonly contributor: typeof CONTRIBUTOR_NAME;
  readonly requestId: string;
}

export type DataRightsContributorResponse = ContributorResponseBase &
  (
    | {
        readonly operation: 'export';
        readonly schemaVersion: typeof EXPORT_SCHEMA_VERSION;
        readonly recordCount: number;
        readonly sha256: string;
        readonly data: DataRightsJsonValue;
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

interface PlanningGoalExportRow {
  id: unknown;
  title: unknown;
  created_at: unknown;
}
interface PlanningProjectExportRow extends PlanningGoalExportRow {
  goal_id: unknown;
}
interface PlanningTaskExportRow extends PlanningGoalExportRow {
  project_id: unknown;
  status: unknown;
  completed_at: unknown;
}
interface TodayAggregateExportRow {
  local_date: unknown;
  aggregate_id: unknown;
  revision_number: unknown;
  revision_token: unknown;
  payload_json: unknown;
  created_at: unknown;
  updated_at: unknown;
}
interface TodayIdempotencyExportRow {
  idempotency_key: unknown;
  request_digest: unknown;
  result_kind: unknown;
  aggregate_id: unknown;
  revision_token: unknown;
  payload_json: unknown;
  created_at: unknown;
}
interface CountRow {
  record_count: unknown;
}
interface ErasureReceiptRow {
  requested_by_user_id: unknown;
  request_id: unknown;
  erased_records: unknown;
  receipt_sha256: unknown;
}

/** Stable credential-free failure for malformed contributor requests or evidence. */
export class PlanningDataRightsError extends Error {
  constructor(message = 'Planning data-rights operation failed validation') {
    super(message);
    this.name = 'PlanningDataRightsError';
  }
}

function requireUuidV4(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new PlanningDataRightsError(`${field} must be a UUIDv4`);
  }
  return value.toLowerCase();
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PlanningDataRightsError(`${field} is invalid`);
  }
  return value;
}

function requireTimestamp(value: unknown, field: string): string | null {
  if (value === null) {
    return null;
  }
  const parsed =
    value instanceof Date ? value : new Date(requireString(value, field));
  if (Number.isNaN(parsed.getTime())) {
    throw new PlanningDataRightsError(`${field} is invalid`);
  }
  return parsed.toISOString();
}

function requireDate(value: unknown): string {
  const text = requireString(value, 'local_date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new PlanningDataRightsError('local_date is invalid');
  }
  return text;
}

function requireNonnegativeInteger(value: unknown, field: string): number {
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (
    typeof numeric !== 'number' ||
    !Number.isSafeInteger(numeric) ||
    numeric < 0
  ) {
    throw new PlanningDataRightsError(`${field} is invalid`);
  }
  return numeric;
}

function requireSha256(value: unknown): string {
  const candidate = requireString(value, 'sha256').toLowerCase();
  if (!SHA_256_PATTERN.test(candidate)) {
    throw new PlanningDataRightsError('sha256 is invalid');
  }
  return candidate;
}

function normalizeJson(value: unknown, depth = 0): DataRightsJsonValue {
  if (depth > MAXIMUM_JSON_DEPTH) {
    throw new PlanningDataRightsError('Planning export JSON is too deeply nested');
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new PlanningDataRightsError('Planning export number is invalid');
    }
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAXIMUM_STRING_LENGTH) {
      throw new PlanningDataRightsError('Planning export string is too large');
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAXIMUM_ARRAY_ITEMS) {
      throw new PlanningDataRightsError('Planning export array is too large');
    }
    return Object.freeze(value.map((entry) => normalizeJson(entry, depth + 1)));
  }
  if (typeof value !== 'object') {
    throw new PlanningDataRightsError('Planning export contains non-JSON data');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new PlanningDataRightsError('Planning export contains non-plain data');
  }
  const entries = Object.entries(value);
  if (entries.length > MAXIMUM_OBJECT_KEYS) {
    throw new PlanningDataRightsError('Planning export object is too large');
  }
  const normalized: Record<string, DataRightsJsonValue> = Object.create(null) as Record<
    string,
    DataRightsJsonValue
  >;
  for (const [key, entry] of entries.sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (!key || key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new PlanningDataRightsError('Planning export contains an invalid key');
    }
    normalized[key] = normalizeJson(entry, depth + 1);
  }
  return Object.freeze(normalized);
}

function canonicalJson(value: DataRightsJsonValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function digest(value: DataRightsJsonValue): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function normalizeRequest(request: DataRightsContributorRequest): {
  readonly request: DataRightsContributorRequest;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
} {
  if (
    !request ||
    request.contractVersion !== DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION
  ) {
    throw new PlanningDataRightsError('Contributor contract version is invalid');
  }
  if (
    request.operation !== 'export' &&
    request.operation !== 'erase_preflight' &&
    request.operation !== 'erase' &&
    request.operation !== 'verify_erased'
  ) {
    throw new PlanningDataRightsError('Contributor operation is invalid');
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

const ERASURE_TABLES = Object.freeze([
  'planning.today_idempotency_records',
  'planning.today_aggregates',
  'planning.tasks',
  'planning.projects',
  'planning.goals',
]);

async function countDeleted(
  client: PlanningSqlClient,
  table: string,
  workspaceId: string,
): Promise<number> {
  if (!ERASURE_TABLES.includes(table)) {
    throw new PlanningDataRightsError('Planning erasure table is invalid');
  }
  const result = await client.query<CountRow>(
    `WITH deleted AS (
       DELETE FROM ${table}
       WHERE workspace_id = $1
       RETURNING 1
     )
     SELECT count(*)::integer AS record_count FROM deleted`,
    [workspaceId],
  );
  return requireNonnegativeInteger(result.rows[0]?.record_count, 'record_count');
}

/** Concrete Planning-owned implementation of life-os.data-rights-contributor.v1. */
export class PlanningDataRightsContributor {
  constructor(private readonly client: TodayTransactionalSqlClient) {}

  async handle(
    untrustedRequest: DataRightsContributorRequest,
  ): Promise<DataRightsContributorResponse> {
    const { request, workspaceId, requestedByUserId, requestId } =
      normalizeRequest(untrustedRequest);
    switch (request.operation) {
      case 'export':
        return await this.exportWorkspace(workspaceId, requestId);
      case 'erase_preflight':
        return await this.preflightErase(workspaceId, requestId);
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
  ): Promise<DataRightsContributorResponse> {
    const [goals, projects, tasks, todayAggregates, todayIdempotency] =
      await Promise.all([
        this.client.query<PlanningGoalExportRow>(
          `SELECT id, title, created_at
           FROM planning.goals
           WHERE workspace_id = $1
           ORDER BY created_at ASC, id ASC`,
          [workspaceId],
        ),
        this.client.query<PlanningProjectExportRow>(
          `SELECT id, goal_id, title, created_at
           FROM planning.projects
           WHERE workspace_id = $1
           ORDER BY created_at ASC, id ASC`,
          [workspaceId],
        ),
        this.client.query<PlanningTaskExportRow>(
          `SELECT id, project_id, title, status, completed_at, created_at
           FROM planning.tasks
           WHERE workspace_id = $1
           ORDER BY created_at ASC, id ASC`,
          [workspaceId],
        ),
        this.client.query<TodayAggregateExportRow>(
          `SELECT local_date::text, aggregate_id, revision_number::text,
                  revision_token, payload_json, created_at, updated_at
           FROM planning.today_aggregates
           WHERE workspace_id = $1
           ORDER BY local_date ASC, aggregate_id ASC`,
          [workspaceId],
        ),
        this.client.query<TodayIdempotencyExportRow>(
          `SELECT idempotency_key, request_digest, result_kind, aggregate_id,
                  revision_token, payload_json, created_at
           FROM planning.today_idempotency_records
           WHERE workspace_id = $1
           ORDER BY created_at ASC, idempotency_key ASC`,
          [workspaceId],
        ),
      ]);

    const data = normalizeJson({
      goals: goals.rows.map((row) => ({
        id: requireUuidV4(row.id, 'goal.id'),
        title: requireString(row.title, 'goal.title'),
        createdAt: requireTimestamp(row.created_at, 'goal.created_at'),
      })),
      projects: projects.rows.map((row) => ({
        id: requireUuidV4(row.id, 'project.id'),
        goalId: requireUuidV4(row.goal_id, 'project.goal_id'),
        title: requireString(row.title, 'project.title'),
        createdAt: requireTimestamp(row.created_at, 'project.created_at'),
      })),
      tasks: tasks.rows.map((row) => ({
        id: requireUuidV4(row.id, 'task.id'),
        projectId: requireUuidV4(row.project_id, 'task.project_id'),
        title: requireString(row.title, 'task.title'),
        status: requireString(row.status, 'task.status'),
        completedAt: requireTimestamp(row.completed_at, 'task.completed_at'),
        createdAt: requireTimestamp(row.created_at, 'task.created_at'),
      })),
      todayAggregates: todayAggregates.rows.map((row) => ({
        localDate: requireDate(row.local_date),
        aggregateId: requireUuidV4(row.aggregate_id, 'today.aggregate_id'),
        revisionNumber: requireString(row.revision_number, 'today.revision_number'),
        revisionToken: requireUuidV4(row.revision_token, 'today.revision_token'),
        payload: normalizeJson(row.payload_json),
        createdAt: requireTimestamp(row.created_at, 'today.created_at'),
        updatedAt: requireTimestamp(row.updated_at, 'today.updated_at'),
      })),
      todayIdempotencyRecords: todayIdempotency.rows.map((row) => ({
        idempotencyKey: requireUuidV4(row.idempotency_key, 'today.idempotency_key'),
        requestDigest: requireSha256(row.request_digest),
        resultKind: requireString(row.result_kind, 'today.result_kind'),
        aggregateId: requireUuidV4(row.aggregate_id, 'today.aggregate_id'),
        revisionToken: requireUuidV4(row.revision_token, 'today.revision_token'),
        payload: normalizeJson(row.payload_json),
        createdAt: requireTimestamp(row.created_at, 'today.created_at'),
      })),
    });
    const recordCount =
      goals.rows.length +
      projects.rows.length +
      tasks.rows.length +
      todayAggregates.rows.length +
      todayIdempotency.rows.length;

    return Object.freeze({
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'export',
      contributor: CONTRIBUTOR_NAME,
      requestId,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      recordCount,
      sha256: digest(data),
      data,
    });
  }

  private async preflightErase(
    workspaceId: string,
    requestId: string,
  ): Promise<DataRightsContributorResponse> {
    const result = await this.client.query<{ erasure_receipts_ready: unknown }>(
      `SELECT
         EXISTS (SELECT 1 FROM planning.goals WHERE workspace_id = $1),
         EXISTS (SELECT 1 FROM planning.projects WHERE workspace_id = $1),
         EXISTS (SELECT 1 FROM planning.tasks WHERE workspace_id = $1),
         EXISTS (SELECT 1 FROM planning.today_aggregates WHERE workspace_id = $1),
         EXISTS (
           SELECT 1 FROM planning.today_idempotency_records WHERE workspace_id = $1
         ),
         to_regclass('planning.data_rights_erasure_receipts') IS NOT NULL
           AS erasure_receipts_ready`,
      [workspaceId],
    );
    const erasureReceiptsReady =
      result.rows[0]?.erasure_receipts_ready === true;
    return Object.freeze({
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'erase_preflight',
      contributor: CONTRIBUTOR_NAME,
      requestId,
      ready: erasureReceiptsReady,
      blockers: erasureReceiptsReady
        ? Object.freeze([])
        : Object.freeze(['planning.data_rights_erasure_receipts unavailable']),
    });
  }

  private async eraseWorkspace(
    workspaceId: string,
    requestedByUserId: string,
    requestId: string,
    idempotencyKey: string,
  ): Promise<DataRightsContributorResponse> {
    return await this.client.transaction(async (transaction) => {
      await transaction.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [workspaceId],
      );
      const existing = await transaction.query<ErasureReceiptRow>(
        `SELECT requested_by_user_id, request_id, erased_records, receipt_sha256
         FROM planning.data_rights_erasure_receipts
         WHERE workspace_id = $1 AND idempotency_key = $2
         LIMIT 1`,
        [workspaceId, idempotencyKey],
      );
      if (existing.rows[0]) {
        const row = existing.rows[0];
        if (
          requireUuidV4(row.requested_by_user_id, 'requested_by_user_id') !==
            requestedByUserId ||
          requireUuidV4(row.request_id, 'request_id') !== requestId
        ) {
          throw new PlanningDataRightsError(
            'Planning erasure idempotency key conflicts with prior authority',
          );
        }
        return Object.freeze({
          contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
          operation: 'erase',
          contributor: CONTRIBUTOR_NAME,
          requestId,
          erasedRecords: requireNonnegativeInteger(
            row.erased_records,
            'erased_records',
          ),
          receiptSha256: requireSha256(row.receipt_sha256),
        });
      }

      let erasedRecords = 0;
      for (const table of ERASURE_TABLES) {
        erasedRecords += await countDeleted(transaction, table, workspaceId);
      }
      const receiptSha256 = digest(
        normalizeJson({
          contributor: CONTRIBUTOR_NAME,
          workspaceId,
          requestedByUserId,
          requestId,
          idempotencyKey,
          erasedRecords,
        }),
      );
      await transaction.query(
        `INSERT INTO planning.data_rights_erasure_receipts
          (workspace_id, idempotency_key, requested_by_user_id, request_id,
           erased_records, receipt_sha256)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          workspaceId,
          idempotencyKey,
          requestedByUserId,
          requestId,
          erasedRecords,
          receiptSha256,
        ],
      );
      return Object.freeze({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'erase',
        contributor: CONTRIBUTOR_NAME,
        requestId,
        erasedRecords,
        receiptSha256,
      });
    });
  }

  private async verifyWorkspaceErased(
    workspaceId: string,
    requestId: string,
  ): Promise<DataRightsContributorResponse> {
    const result: PlanningSqlQueryResult<CountRow> = await this.client.query(
      `SELECT (
         (SELECT count(*) FROM planning.goals WHERE workspace_id = $1) +
         (SELECT count(*) FROM planning.projects WHERE workspace_id = $1) +
         (SELECT count(*) FROM planning.tasks WHERE workspace_id = $1) +
         (SELECT count(*) FROM planning.today_aggregates WHERE workspace_id = $1) +
         (SELECT count(*) FROM planning.today_idempotency_records WHERE workspace_id = $1)
       )::integer AS record_count`,
      [workspaceId],
    );
    const erased =
      requireNonnegativeInteger(result.rows[0]?.record_count, 'record_count') === 0;
    const evidenceSha256 = digest(
      normalizeJson({ contributor: CONTRIBUTOR_NAME, workspaceId, erased }),
    );
    return Object.freeze({
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'verify_erased',
      contributor: CONTRIBUTOR_NAME,
      requestId,
      erased,
      evidenceSha256,
    });
  }
}
