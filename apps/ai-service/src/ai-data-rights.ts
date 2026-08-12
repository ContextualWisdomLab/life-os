import { createHash } from 'node:crypto';
import type {
  ProposalAuditSqlClient,
  ProposalAuditSqlQueryResult,
} from './postgres-proposal-audit-repository';

export const AI_DATA_RIGHTS_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v1' as const;
const CONTRIBUTOR_NAME = 'ai.service' as const;
const EXPORT_SCHEMA_VERSION = 'ai.data-rights.v1' as const;
const MAX_EXPORT_RECORDS = 1_000;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_CONTAINER_ITEMS = 2_000;
const MAX_JSON_STRING_BYTES = 64 * 1024;
const MAX_JSON_KEY_BYTES = 256;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;

/** JSON-safe value returned by the AI-owned contributor. */
export type AiDataRightsJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly AiDataRightsJsonValue[]
  | { readonly [key: string]: AiDataRightsJsonValue };

/** Versioned request accepted by the AI-owned contributor. */
export type AiDataRightsRequest = Readonly<{
  contractVersion: typeof AI_DATA_RIGHTS_CONTRACT_VERSION;
  operation: 'export' | 'erase_preflight' | 'erase' | 'verify_erased';
  workspaceId: string;
  requestedByUserId: string;
  requestId: string;
  idempotencyKey?: string;
}>;

/** Successful response emitted by the AI-owned contributor. */
export type AiDataRightsResponse =
  | Readonly<{
      contractVersion: typeof AI_DATA_RIGHTS_CONTRACT_VERSION;
      contributor: typeof CONTRIBUTOR_NAME;
      operation: 'export';
      requestId: string;
      schemaVersion: typeof EXPORT_SCHEMA_VERSION;
      recordCount: number;
      sha256: string;
      data: AiDataRightsJsonValue;
    }>
  | Readonly<{
      contractVersion: typeof AI_DATA_RIGHTS_CONTRACT_VERSION;
      contributor: typeof CONTRIBUTOR_NAME;
      operation: 'erase_preflight';
      requestId: string;
      ready: boolean;
      blockers: readonly string[];
    }>
  | Readonly<{
      contractVersion: typeof AI_DATA_RIGHTS_CONTRACT_VERSION;
      contributor: typeof CONTRIBUTOR_NAME;
      operation: 'erase';
      requestId: string;
      erasedRecords: number;
      receiptSha256: string;
    }>
  | Readonly<{
      contractVersion: typeof AI_DATA_RIGHTS_CONTRACT_VERSION;
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
  proposal_audit_records: unknown;
  proposal_decision_events: unknown;
}

/** Privilege evidence required before destructive AI erasure. */
interface PrivilegeRow {
  erasure_receipts_ready: unknown;
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
export class AiDataRightsError extends Error {
  /** Creates one bounded public data-rights failure. */
  constructor() {
    super('AI data-rights operation failed');
    this.name = 'AiDataRightsError';
  }
}

/** Raises the stable contributor failure without retaining untrusted details. */
function invalidDataRights(): never {
  throw new AiDataRightsError();
}

/** Requires a plain JSON object at the request boundary. */
function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object') return invalidDataRights();
  if (value === null) return invalidDataRights();
  if (Array.isArray(value)) return invalidDataRights();
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
  if (typeof value !== 'string') return invalidDataRights();
  if (!UUID_V4_PATTERN.test(value)) return invalidDataRights();
  return value.toLowerCase();
}

/** Requires one non-negative safe PostgreSQL integer. */
function requireNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number') return invalidDataRights();
  if (!Number.isSafeInteger(value)) return invalidDataRights();
  if (value < 0) return invalidDataRights();
  return value;
}

/** Requires one PostgreSQL boolean without truthy coercion. */
function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalidDataRights();
  return value;
}

/** Requires a canonical lower-case SHA-256 hex digest. */
function requireSha256(value: unknown): string {
  if (typeof value !== 'string') return invalidDataRights();
  if (!SHA_256_PATTERN.test(value)) return invalidDataRights();
  return value;
}

/** Converts untrusted JSON evidence to deterministic canonical JSON while enforcing bounds. */
function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_JSON_DEPTH) return invalidDataRights();
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return invalidDataRights();
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_JSON_STRING_BYTES) {
      return invalidDataRights();
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_CONTAINER_ITEMS) return invalidDataRights();
    return `[${value.map((entry) => canonicalJson(entry, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidDataRights();
    }
    const entries = Object.entries(value);
    if (entries.length > MAX_JSON_CONTAINER_ITEMS) return invalidDataRights();
    entries.sort(([left], [right]) => left.localeCompare(right));
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
function requireJsonValue(value: unknown): AiDataRightsJsonValue {
  canonicalJson(value);
  return value as AiDataRightsJsonValue;
}

/** Computes deterministic SHA-256 evidence over canonical bounded JSON. */
function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

/** Requires exactly one PostgreSQL row and rejects missing or duplicate evidence. */
function exactlyOne<Row>(result: ProposalAuditSqlQueryResult<Row>): Row {
  if (result.rows.length !== 1) return invalidDataRights();
  const row = result.rows[0];
  if (row === undefined) return invalidDataRights();
  return row;
}

/** Validates the exact v1 request shape before any AI persistence access. */
function normalizeRequest(untrusted: unknown): NormalizedRequest {
  const record = requireRecord(untrusted);
  if (record.contractVersion !== AI_DATA_RIGHTS_CONTRACT_VERSION) {
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
export class AiDataRightsContributor {
  /** Creates the contributor over the AI service's own SQL boundary. */
  constructor(private readonly client: ProposalAuditSqlClient) {}

  /** Executes SQL while replacing database details with one credential-free failure. */
  private async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      throw new AiDataRightsError();
    }
  }

  /** Validates and dispatches one internal contributor request. */
  async handle(untrustedRequest: unknown): Promise<AiDataRightsResponse> {
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

  /** Exports one deterministic bounded AI audit section for one workspace. */
  private async exportWorkspace(
    workspaceId: string,
    requestId: string,
  ): Promise<AiDataRightsResponse> {
    const row = exactlyOne(
      await this.query<ExportRow>(
        `SELECT
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'proposalId', proposal_id,
               'modelId', model_id,
               'request', request_json,
               'requestDigest', request_digest,
               'summary', summary,
               'rationale', rationale_json,
               'operations', operations_json,
               'requiresConfirmation', requires_confirmation,
               'contentDigest', content_digest,
               'createdAt', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'recordedAt', to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) ORDER BY created_at ASC, proposal_id ASC)
             FROM (
               SELECT
                 proposal_id,
                 model_id,
                 request_json,
                 request_digest,
                 summary,
                 rationale_json,
                 operations_json,
                 requires_confirmation,
                 content_digest,
                 created_at,
                 recorded_at
               FROM ai.proposal_audit_records
               WHERE workspace_id = $1
               ORDER BY created_at ASC, proposal_id ASC
               LIMIT $2
             ) AS bounded_proposals
           ), '[]'::jsonb) AS proposal_audit_records,
           COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'decisionId', id,
               'proposalId', proposal_id,
               'proposalContentDigest', proposal_content_digest,
               'actorId', actor_id,
               'decisionKind', decision_kind,
               'reason', reason_text,
               'decidedAt', to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'recordedAt', to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) ORDER BY recorded_at ASC, id ASC)
             FROM (
               SELECT
                 id,
                 proposal_id,
                 proposal_content_digest,
                 actor_id,
                 decision_kind,
                 reason_text,
                 decided_at,
                 recorded_at
               FROM ai.proposal_decision_events
               WHERE workspace_id = $1
               ORDER BY recorded_at ASC, id ASC
               LIMIT $2
             ) AS bounded_decisions
           ), '[]'::jsonb) AS proposal_decision_events`,
        [workspaceId, MAX_EXPORT_RECORDS + 1],
      ),
    );
    if (!Array.isArray(row.proposal_audit_records)) return invalidDataRights();
    if (!Array.isArray(row.proposal_decision_events)) return invalidDataRights();
    const recordCount =
      row.proposal_audit_records.length + row.proposal_decision_events.length;
    if (recordCount > MAX_EXPORT_RECORDS) return invalidDataRights();
    const data = Object.freeze({
      proposals: requireJsonValue(row.proposal_audit_records),
      decisions: requireJsonValue(row.proposal_decision_events),
    });
    return {
      contractVersion: AI_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'export',
      requestId,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      recordCount,
      sha256: digest(data),
      data,
    };
  }

  /** Checks owner-controlled erasure privileges without mutating tenant data. */
  private async preflightErase(requestId: string): Promise<AiDataRightsResponse> {
    const row = exactlyOne(
      await this.query<PrivilegeRow>(
        `SELECT
           COALESCE(has_table_privilege(
             current_user,
             to_regclass('ai.data_rights_erasure_receipts'),
             'SELECT,INSERT'
           ), false) AS erasure_receipts_ready,
           COALESCE(has_function_privilege(
             current_user,
             to_regprocedure('ai.erase_workspace_data(uuid,uuid,uuid,uuid)'),
             'EXECUTE'
           ), false) AS erasure_function_ready`,
        [],
      ),
    );
    const receiptsReady = requireBoolean(row.erasure_receipts_ready);
    const functionReady = requireBoolean(row.erasure_function_ready);
    const blockers: string[] = [];
    if (!receiptsReady) blockers.push('ai_erasure_receipt_privileges_unavailable');
    if (!functionReady) blockers.push('ai_erasure_function_unavailable');
    return {
      contractVersion: AI_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'erase_preflight',
      requestId,
      ready: blockers.length === 0,
      blockers: Object.freeze(blockers),
    };
  }

  /** Executes one atomic replay-safe AI-owned erasure. */
  private async eraseWorkspace(
    request: Extract<NormalizedRequest, { readonly operation: 'erase' }>,
  ): Promise<AiDataRightsResponse> {
    const row = exactlyOne(
      await this.query<EraseRow>(
        `SELECT
           result_erased_records AS erased_records,
           result_receipt_sha256 AS receipt_sha256
         FROM ai.erase_workspace_data($1, $2, $3, $4)`,
        [
          request.workspaceId,
          request.requestedByUserId,
          request.requestId,
          request.idempotencyKey,
        ],
      ),
    );
    return {
      contractVersion: AI_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'erase',
      requestId: request.requestId,
      erasedRecords: requireNonNegativeInteger(row.erased_records),
      receiptSha256: requireSha256(row.receipt_sha256),
    };
  }

  /** Verifies that no live AI-owned tenant audit records remain. */
  private async verifyErased(
    workspaceId: string,
    requestId: string,
  ): Promise<AiDataRightsResponse> {
    const row = exactlyOne(
      await this.query<CountRow>(
        `SELECT (
           (SELECT count(*) FROM ai.proposal_audit_records WHERE workspace_id = $1) +
           (SELECT count(*) FROM ai.proposal_decision_events WHERE workspace_id = $1)
         )::integer AS record_count`,
        [workspaceId],
      ),
    );
    const liveRecords = requireNonNegativeInteger(row.record_count);
    return {
      contractVersion: AI_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'verify_erased',
      requestId,
      erased: liveRecords === 0,
      evidenceSha256: digest({ contributor: CONTRIBUTOR_NAME, workspaceId, liveRecords }),
    };
  }
}
