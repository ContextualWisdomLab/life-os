import { createHash } from 'node:crypto';
import type {
  ProposalAuditSqlClient,
  ProposalAuditSqlQueryResult,
} from './postgres-proposal-audit-repository';

export const AI_DATA_RIGHTS_CONTRACT_VERSION =
  'life-os.data-rights-contributor.v1' as const;
const CONTRIBUTOR_NAME = 'ai.service' as const;
const EXPORT_SCHEMA_VERSION = 'ai.data-rights.v1' as const;
const EXPORT_CURSOR_VERSION = 'ai.data-rights.cursor.v1' as const;
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

/** JSON-safe value returned by the AI-owned contributor. */
export type AiDataRightsJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly AiDataRightsJsonValue[]
  | { readonly [key: string]: AiDataRightsJsonValue };

/** Shared validated authority fields carried by every AI data-rights request. */
interface AiDataRightsRequestBase {
  readonly contractVersion: typeof AI_DATA_RIGHTS_CONTRACT_VERSION;
  readonly workspaceId: string;
  readonly requestedByUserId: string;
  readonly requestId: string;
}

/** Versioned request accepted by the AI-owned contributor. */
export type AiDataRightsRequest =
  | Readonly<
      AiDataRightsRequestBase & {
        readonly operation: 'export';
        readonly cursor?: string;
      }
    >
  | Readonly<
      AiDataRightsRequestBase & {
        readonly operation: 'erase_preflight' | 'verify_erased';
      }
    >
  | Readonly<
      AiDataRightsRequestBase & {
        readonly operation: 'erase';
        readonly idempotencyKey: string;
      }
    >;

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
      nextCursor?: string;
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

/** Stable ordering discriminator for exported proposal and decision evidence. */
type EvidenceKind = 'decision' | 'proposal';

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
  readonly data: AiDataRightsJsonValue;
}

/** Privilege evidence required before destructive AI erasure. */
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

/** Compares strings by UTF-16 code units without locale or ICU dependence. */
function compareUtf16CodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Requires one canonical UTC instant suitable for PostgreSQL keyset comparison. */
function requireIsoInstant(value: unknown): string {
  if (typeof value !== 'string') return invalidDataRights();
  if (!ISO_INSTANT_PATTERN.test(value)) return invalidDataRights();
  if (!Number.isFinite(Date.parse(value))) return invalidDataRights();
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
    entries.sort(([left], [right]) => compareUtf16CodeUnits(left, right));
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

/** Validates one JSON value and retains its already-computed canonical form. */
function canonicalEvidence(value: unknown): Readonly<{
  value: AiDataRightsJsonValue;
  canonical: string;
}> {
  return Object.freeze({
    value: value as AiDataRightsJsonValue,
    canonical: canonicalJson(value),
  });
}

/** Computes deterministic SHA-256 evidence over an existing canonical string. */
function digestCanonical(canonical: string): string {
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Computes deterministic SHA-256 evidence over bounded JSON. */
function digest(value: unknown): string {
  return digestCanonical(canonicalJson(value));
}

/** Requires exactly one PostgreSQL row and rejects missing or duplicate evidence. */
function exactlyOne<Row>(result: ProposalAuditSqlQueryResult<Row>): Row {
  if (result.rows.length !== 1) return invalidDataRights();
  const row = result.rows[0];
  if (row === undefined) return invalidDataRights();
  return row;
}

/** Decodes and validates one bounded opaque export cursor. */
function decodeExportCursor(value: unknown): ExportCursor {
  if (typeof value !== 'string') return invalidDataRights();
  if (!value || value.length > MAX_EXPORT_CURSOR_BYTES) return invalidDataRights();
  if (!BASE64URL_PATTERN.test(value)) return invalidDataRights();

  let decoded: string;
  try {
    decoded = Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return invalidDataRights();
  }
  if (Buffer.byteLength(decoded, 'utf8') > MAX_EXPORT_CURSOR_BYTES) {
    return invalidDataRights();
  }

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
  if (record.version !== EXPORT_CURSOR_VERSION) return invalidDataRights();
  if (record.evidenceKind !== 'decision' && record.evidenceKind !== 'proposal') {
    return invalidDataRights();
  }
  return Object.freeze({
    evidenceTime: requireIsoInstant(record.evidenceTime),
    evidenceKind: record.evidenceKind,
    evidenceId: requireUuidV4(record.evidenceId),
  });
}

/** Encodes one validated keyset position as an opaque bounded cursor. */
function encodeExportCursor(cursor: ExportCursor): string {
  const serialized = canonicalJson({
    version: EXPORT_CURSOR_VERSION,
    evidenceTime: cursor.evidenceTime,
    evidenceKind: cursor.evidenceKind,
    evidenceId: cursor.evidenceId,
  });
  const encoded = Buffer.from(serialized, 'utf8').toString('base64url');
  if (encoded.length > MAX_EXPORT_CURSOR_BYTES) return invalidDataRights();
  return encoded;
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
  if (record.evidenceKind !== 'decision' && record.evidenceKind !== 'proposal') {
    return invalidDataRights();
  }
  return Object.freeze({
    evidenceTime: requireIsoInstant(record.evidenceTime),
    evidenceKind: record.evidenceKind,
    evidenceId: requireUuidV4(record.evidenceId),
    data: record.data as AiDataRightsJsonValue,
  });
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

  /** Exports one deterministic bounded page of AI audit evidence. */
  private async exportWorkspace(
    workspaceId: string,
    requestId: string,
    cursor: ExportCursor | undefined,
  ): Promise<AiDataRightsResponse> {
    const row = exactlyOne(
      await this.query<ExportRow>(
        `WITH candidate_evidence AS (
           SELECT
             created_at AS evidence_time,
             'proposal'::text AS evidence_kind,
             proposal_id AS evidence_id,
             jsonb_build_object(
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
             ) AS evidence_data
           FROM ai.proposal_audit_records
           WHERE workspace_id = $1
             AND (
               $2::timestamptz IS NULL
               OR (created_at, 'proposal'::text, proposal_id) >
                  ($2::timestamptz, $3::text, $4::uuid)
             )
           UNION ALL
           SELECT
             recorded_at AS evidence_time,
             'decision'::text AS evidence_kind,
             id AS evidence_id,
             jsonb_build_object(
               'decisionId', id,
               'proposalId', proposal_id,
               'proposalContentDigest', proposal_content_digest,
               'actorId', actor_id,
               'decisionKind', decision_kind,
               'reason', reason_text,
               'decidedAt', to_char(decided_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
               'recordedAt', to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
             ) AS evidence_data
           FROM ai.proposal_decision_events
           WHERE workspace_id = $1
             AND (
               $2::timestamptz IS NULL
               OR (recorded_at, 'decision'::text, id) >
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
    if (!Array.isArray(row.evidence_records)) return invalidDataRights();
    if (row.evidence_records.length > MAX_EXPORT_RECORDS + 1) {
      return invalidDataRights();
    }

    const page = row.evidence_records
      .slice(0, MAX_EXPORT_RECORDS)
      .map((record) => requireExportEvidenceRecord(record));
    const proposals: AiDataRightsJsonValue[] = [];
    const decisions: AiDataRightsJsonValue[] = [];
    for (const record of page) {
      if (record.evidenceKind === 'proposal') {
        proposals.push(record.data);
      } else {
        decisions.push(record.data);
      }
    }
    const evidence = canonicalEvidence(
      Object.freeze({
        proposals: Object.freeze(proposals),
        decisions: Object.freeze(decisions),
      }),
    );
    const hasMore = row.evidence_records.length > MAX_EXPORT_RECORDS;
    const last = page.at(-1);
    if (hasMore && last === undefined) return invalidDataRights();
    const nextCursor =
      hasMore && last !== undefined
        ? encodeExportCursor({
            evidenceTime: last.evidenceTime,
            evidenceKind: last.evidenceKind,
            evidenceId: last.evidenceId,
          })
        : undefined;

    return {
      contractVersion: AI_DATA_RIGHTS_CONTRACT_VERSION,
      contributor: CONTRIBUTOR_NAME,
      operation: 'export',
      requestId,
      schemaVersion: EXPORT_SCHEMA_VERSION,
      recordCount: page.length,
      sha256: digestCanonical(evidence.canonical),
      data: evidence.value,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    };
  }

  /** Checks owner-controlled erasure privileges without mutating tenant data. */
  private async preflightErase(requestId: string): Promise<AiDataRightsResponse> {
    const row = exactlyOne(
      await this.query<PrivilegeRow>(
        `SELECT COALESCE(has_function_privilege(
           current_user,
           to_regprocedure('ai.erase_workspace_data(uuid,uuid,uuid,uuid)'),
           'EXECUTE'
         ), false) AS erasure_function_ready`,
        [],
      ),
    );
    const functionReady = requireBoolean(row.erasure_function_ready);
    const blockers = functionReady ? [] : ['ai_erasure_function_unavailable'];
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
      evidenceSha256: digest({
        contributor: CONTRIBUTOR_NAME,
        workspaceId,
        liveRecords,
      }),
    };
  }
}
