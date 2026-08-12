import { createHash } from 'node:crypto';

/** Must remain byte-for-byte aligned with packages/contracts/src/data-rights.ts. */
export const DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v1' as const;
const CONTRIBUTOR_NAME = 'review.service' as const;
const EXPORT_SCHEMA_VERSION = 'review.data-rights.v1' as const;
const EXPORT_PAGE_SIZE = 1_000;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

/** Minimal SQL result contract used by the Review data-rights contributor. */
export interface ReviewDataRightsSqlQueryResult<Row> {
  readonly rows: Row[];
}

/** Parameterized Review-owned SQL boundary used by data-rights operations. */
export interface ReviewDataRightsSqlClient {
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ReviewDataRightsSqlQueryResult<Row>>;
}

/** Transaction-capable Review SQL boundary required by destructive erasure. */
export interface ReviewDataRightsTransactionalSqlClient extends ReviewDataRightsSqlClient {
  transaction<T>(
    operation: (client: ReviewDataRightsSqlClient) => Promise<T>,
  ): Promise<T>;
}

/** JSON values emitted by the Review-owned export surface. */
export type ReviewDataRightsJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly ReviewDataRightsJsonValue[]
  | { readonly [key: string]: ReviewDataRightsJsonValue };

interface RequestBase {
  readonly contractVersion: typeof DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
}

/** Authorized request accepted by the Review-owned contributor. */
export type ReviewDataRightsRequest = RequestBase &
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

/** Successful Review-owned evidence returned to the Identity orchestrator. */
export type ReviewDataRightsResponse = ResponseBase &
  (
    | {
        readonly operation: 'export';
        readonly schemaVersion: typeof EXPORT_SCHEMA_VERSION;
        readonly recordCount: number;
        readonly sha256: string;
        readonly data: ReviewDataRightsJsonValue;
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

interface CompletionExportRow {
  id: unknown;
  workspace_id: unknown;
  ritual_kind: unknown;
  period_start_date: unknown;
  idempotency_key: unknown;
  completed_step_count: unknown;
  total_step_count: unknown;
  planned_item_count: unknown;
  completed_item_count: unknown;
  habit_completion_count: unknown;
  reflection_text: unknown;
  completed_at: unknown;
  payload_digest: unknown;
  recorded_at: unknown;
}

interface PrivilegeRow {
  completions_ready: unknown;
  receipts_ready: unknown;
}

interface ReceiptRow {
  idempotency_key: unknown;
  workspace_id: unknown;
  requested_by_user_id: unknown;
  request_id: unknown;
  erased_records: unknown;
  receipt_sha256: unknown;
}

interface CountRow {
  record_count: unknown;
}

/** Credential-free failure for malformed requests, rows, or destructive evidence. */
export class ReviewDataRightsError extends Error {
  constructor(message = 'Review data-rights operation failed validation') {
    super(message);
    this.name = 'ReviewDataRightsError';
  }
}

function fail(message?: string): never {
  throw new ReviewDataRightsError(message);
}

function requireUuidV4(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    return fail(`${field} must be a UUIDv4`);
  }
  return value.toLowerCase();
}

function requireString(
  value: unknown,
  field: string,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength
  ) {
    return fail(`${field} is invalid`);
  }
  return value;
}

function requireOptionalString(
  value: unknown,
  field: string,
  maximumLength: number,
): string | null {
  if (value === null || value === undefined) return null;
  return requireString(value, field, maximumLength);
}

function requireInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const candidate = typeof value === 'string' ? Number(value) : value;
  if (
    typeof candidate !== 'number' ||
    !Number.isSafeInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    return fail(`${field} is invalid`);
  }
  return candidate;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return fail(`${field} is invalid`);
  return value;
}

function requireTimestamp(value: unknown, field: string): string {
  const candidate =
    value instanceof Date ? value : new Date(requireString(value, field, 64));
  if (Number.isNaN(candidate.getTime())) return fail(`${field} is invalid`);
  return candidate.toISOString();
}

function requireLocalDate(value: unknown): string {
  const candidate =
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : requireString(value, 'period_start_date', 10);
  if (!LOCAL_DATE_PATTERN.test(candidate)) {
    return fail('period_start_date is invalid');
  }
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== candidate
  ) {
    return fail('period_start_date is invalid');
  }
  return candidate;
}

function requireSha256(value: unknown, field: string): string {
  const candidate = requireString(value, field, 64).toLowerCase();
  if (!SHA_256_PATTERN.test(candidate)) return fail(`${field} is invalid`);
  return candidate;
}

function canonicalJson(value: ReviewDataRightsJsonValue): string {
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

function digest(value: ReviewDataRightsJsonValue): string {
  return createHash('sha256')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

function normalizeRequest(request: ReviewDataRightsRequest): {
  readonly request: ReviewDataRightsRequest;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
} {
  if (
    !request ||
    request.contractVersion !== DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION
  ) {
    return fail('Contributor contract version is invalid');
  }
  if (
    request.operation !== 'export' &&
    request.operation !== 'erase_preflight' &&
    request.operation !== 'erase' &&
    request.operation !== 'verify_erased'
  ) {
    return fail('Contributor operation is invalid');
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

function normalizeCompletion(
  row: CompletionExportRow,
  expectedWorkspaceId: string,
): ReviewDataRightsJsonValue {
  const workspaceId = requireUuidV4(row.workspace_id, 'workspace_id');
  if (workspaceId !== expectedWorkspaceId) {
    return fail('Review completion workspace does not match requested workspace');
  }
  const ritualKind = requireString(row.ritual_kind, 'ritual_kind', 32);
  if (
    ritualKind !== 'daily-planning' &&
    ritualKind !== 'daily-shutdown' &&
    ritualKind !== 'weekly-review'
  ) {
    return fail('ritual_kind is invalid');
  }
  const totalStepCount = requireInteger(
    row.total_step_count,
    'total_step_count',
    1,
    64,
  );
  const completedStepCount = requireInteger(
    row.completed_step_count,
    'completed_step_count',
    0,
    totalStepCount,
  );
  const plannedItemCount = requireInteger(
    row.planned_item_count,
    'planned_item_count',
    0,
    10_000,
  );
  const completedItemCount = requireInteger(
    row.completed_item_count,
    'completed_item_count',
    0,
    plannedItemCount,
  );
  return Object.freeze({
    id: requireUuidV4(row.id, 'completion_id'),
    workspaceId,
    ritualKind,
    periodStartDate: requireLocalDate(row.period_start_date),
    idempotencyKey: requireUuidV4(row.idempotency_key, 'idempotency_key'),
    completedStepCount,
    totalStepCount,
    plannedItemCount,
    completedItemCount,
    habitCompletionCount: requireInteger(
      row.habit_completion_count,
      'habit_completion_count',
      0,
      10_000,
    ),
    reflection: requireOptionalString(
      row.reflection_text,
      'reflection_text',
      2_000,
    ),
    completedAt: requireTimestamp(row.completed_at, 'completed_at'),
    payloadDigest: requireSha256(row.payload_digest, 'payload_digest'),
    recordedAt: requireTimestamp(row.recorded_at, 'recorded_at'),
  });
}

async function collectRows(
  client: ReviewDataRightsSqlClient,
  workspaceId: string,
): Promise<CompletionExportRow[]> {
  const rows: CompletionExportRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.query<CompletionExportRow>(
      `SELECT id, workspace_id, ritual_kind, period_start_date,
              idempotency_key, completed_step_count, total_step_count,
              planned_item_count, completed_item_count, habit_completion_count,
              reflection_text, completed_at, payload_digest, recorded_at
       FROM guided_review.review_completions
       WHERE workspace_id = $1
       ORDER BY recorded_at ASC, id ASC
       LIMIT $2 OFFSET $3`,
      [workspaceId, EXPORT_PAGE_SIZE, offset],
    );
    rows.push(...page.rows);
    if (page.rows.length < EXPORT_PAGE_SIZE) return rows;
    offset += page.rows.length;
  }
}

function normalizeReceipt(row: ReceiptRow): {
  readonly idempotencyKey: string;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
  readonly erasedRecords: number;
  readonly receiptSha256: string;
} {
  return {
    idempotencyKey: requireUuidV4(row.idempotency_key, 'idempotency_key'),
    workspaceId: requireUuidV4(row.workspace_id, 'workspace_id'),
    requestedByUserId: requireUuidV4(
      row.requested_by_user_id,
      'requested_by_user_id',
    ),
    requestId: requireUuidV4(row.request_id, 'request_id'),
    erasedRecords: requireInteger(row.erased_records, 'erased_records', 0),
    receiptSha256: requireSha256(row.receipt_sha256, 'receipt_sha256'),
  };
}

/** Concrete Review-owned implementation of life-os.data-rights-contributor.v1. */
export class ReviewDataRightsContributor {
  /** Creates a contributor over Review-owned transactional persistence only. */
  constructor(
    private readonly client: ReviewDataRightsTransactionalSqlClient,
  ) {}

  /** Validates one request before dispatching to Review-owned export/erasure work. */
  async handle(
    untrustedRequest: ReviewDataRightsRequest,
  ): Promise<ReviewDataRightsResponse> {
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
  ): Promise<ReviewDataRightsResponse> {
    return await this.client.transaction(async (transaction) => {
      await transaction.query(
        'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
        [],
      );
      const rows = await collectRows(transaction, workspaceId);
      const reviewCompletions = Object.freeze(
        rows.map((row) => normalizeCompletion(row, workspaceId)),
      );
      const data = Object.freeze({ reviewCompletions });
      return {
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'export',
        contributor: CONTRIBUTOR_NAME,
        requestId,
        schemaVersion: EXPORT_SCHEMA_VERSION,
        recordCount: reviewCompletions.length,
        sha256: digest(data),
        data,
      };
    });
  }

  private async readPrivileges(client: ReviewDataRightsSqlClient): Promise<{
    readonly completionsReady: boolean;
    readonly receiptsReady: boolean;
  }> {
    const result = await client.query<PrivilegeRow>(
      `SELECT
         COALESCE(
           has_table_privilege(
             current_user,
             to_regclass('guided_review.review_completions'),
             'SELECT,DELETE'
           ),
           false
         ) AS completions_ready,
         COALESCE(
           has_table_privilege(
             current_user,
             to_regclass('guided_review.data_rights_erasure_receipt'),
             'SELECT,INSERT'
           ),
           false
         ) AS receipts_ready`,
      [],
    );
    if (result.rows.length !== 1 || !result.rows[0]) {
      return fail('Review erasure privilege evidence is malformed');
    }
    return {
      completionsReady: requireBoolean(
        result.rows[0].completions_ready,
        'completions_ready',
      ),
      receiptsReady: requireBoolean(
        result.rows[0].receipts_ready,
        'receipts_ready',
      ),
    };
  }

  private async preflightErase(
    requestId: string,
  ): Promise<ReviewDataRightsResponse> {
    const privileges = await this.readPrivileges(this.client);
    const blockers: string[] = [];
    if (!privileges.completionsReady) {
      blockers.push('review_completion_erasure_privileges_unavailable');
    }
    if (!privileges.receiptsReady) {
      blockers.push('review_erasure_receipt_privileges_unavailable');
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
  ): Promise<ReviewDataRightsResponse> {
    return await this.client.transaction(async (transaction) => {
      const privileges = await this.readPrivileges(transaction);
      if (!privileges.completionsReady || !privileges.receiptsReady) {
        return fail('Review erasure authority is unavailable');
      }
      await transaction.query(
        `SELECT
           pg_advisory_xact_lock(hashtextextended($1::text, 0)),
           pg_advisory_xact_lock(hashtextextended($2::text, 1))`,
        [workspaceId, idempotencyKey],
      );
      const existing = await transaction.query<ReceiptRow>(
        `SELECT idempotency_key, workspace_id, requested_by_user_id,
                request_id, erased_records, receipt_sha256
         FROM guided_review.data_rights_erasure_receipt
         WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (existing.rows.length > 1) {
        return fail('Review erasure receipt evidence is malformed');
      }
      if (existing.rows.length === 1 && existing.rows[0]) {
        const receipt = normalizeReceipt(existing.rows[0]);
        if (
          receipt.idempotencyKey !== idempotencyKey ||
          receipt.workspaceId !== workspaceId ||
          receipt.requestedByUserId !== requestedByUserId ||
          receipt.requestId !== requestId
        ) {
          return fail('Review erasure idempotency authority conflicts');
        }
        return {
          contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
          operation: 'erase',
          contributor: CONTRIBUTOR_NAME,
          requestId,
          erasedRecords: receipt.erasedRecords,
          receiptSha256: receipt.receiptSha256,
        };
      }

      const deleted = await transaction.query<{ id: unknown }>(
        `DELETE FROM guided_review.review_completions
         WHERE workspace_id = $1
         RETURNING id`,
        [workspaceId],
      );
      for (const row of deleted.rows) {
        requireUuidV4(row.id, 'erased_completion_id');
      }
      const erasedRecords = deleted.rows.length;
      const receiptSha256 = digest({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        contributor: CONTRIBUTOR_NAME,
        operation: 'erase',
        workspaceId,
        requestedByUserId,
        requestId,
        idempotencyKey,
        erasedRecords,
      });
      await transaction.query(
        `INSERT INTO guided_review.data_rights_erasure_receipt
          (idempotency_key, workspace_id, requested_by_user_id, request_id,
           erased_records, receipt_sha256)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          idempotencyKey,
          workspaceId,
          requestedByUserId,
          requestId,
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
  ): Promise<ReviewDataRightsResponse> {
    const result = await this.client.query<CountRow>(
      `SELECT COUNT(*) AS record_count
       FROM guided_review.review_completions
       WHERE workspace_id = $1`,
      [workspaceId],
    );
    if (result.rows.length !== 1 || !result.rows[0]) {
      return fail('Review erasure verification evidence is malformed');
    }
    const remainingRecords = requireInteger(
      result.rows[0].record_count,
      'record_count',
      0,
    );
    return {
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'verify_erased',
      contributor: CONTRIBUTOR_NAME,
      requestId,
      erased: remainingRecords === 0,
      evidenceSha256: digest({ workspaceId, remainingRecords }),
    };
  }
}
