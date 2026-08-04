import {
  type ProposalAuditRecord,
  type ProposalAuditRepository,
  ProposalDigestMismatchError,
  type ProposalDecisionEvent,
  validateProposalAuditRecord,
  validateProposalDecisionEvent,
} from './proposal-audit-domain';

export { ProposalDigestMismatchError } from './proposal-audit-domain';

/** Minimal parameterized SQL result boundary for proposal audit persistence. */
export interface ProposalAuditSqlQueryResult<Row> {
  rows: Row[];
}

/** Minimal parameterized SQL client boundary for proposal audit persistence. */
export interface ProposalAuditSqlClient {
  /** Executes one parameterized SQL statement and returns bounded rows. */
  query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>>;
}

/** Untrusted PostgreSQL row for one immutable proposal revision. */
interface ProposalAuditRow {
  proposal_id: unknown;
  workspace_id: unknown;
  model_id: unknown;
  request_json: unknown;
  request_digest: unknown;
  summary: unknown;
  rationale_json: unknown;
  operations_json: unknown;
  requires_confirmation: unknown;
  content_digest: unknown;
  created_at: unknown;
  recorded_at: unknown;
}

/** Untrusted PostgreSQL row for one append-only proposal decision. */
interface ProposalDecisionRow {
  id: unknown;
  workspace_id: unknown;
  proposal_id: unknown;
  proposal_content_digest: unknown;
  actor_id: unknown;
  decision_kind: unknown;
  reason_text: unknown;
  idempotency_key: unknown;
  decided_at: unknown;
  recorded_at: unknown;
}

/** Minimal PostgreSQL error classification used for named constraint mapping. */
interface PostgreSqlErrorShape {
  code?: unknown;
  constraint?: unknown;
}

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_CONSTRAINT = 'proposal_decision_events_idempotency_unique';
const DIGEST_FOREIGN_KEY_CONSTRAINT =
  'proposal_decision_events_proposal_digest_foreign';

/** Credential-free failure for malformed rows and database errors. */
export class ProposalAuditPersistenceError extends Error {
  /** Creates a stable credential-free database failure. */
  constructor() {
    super('Proposal audit persistence operation failed');
    this.name = 'ProposalAuditPersistenceError';
  }
}

/** Raised when one decision idempotency key is reused with another payload. */
export class ProposalDecisionConflictError extends Error {
  /** Creates a stable conflict for non-identical idempotency replay. */
  constructor() {
    super('Proposal decision idempotency key conflicts with an earlier event');
    this.name = 'ProposalDecisionConflictError';
  }
}

/** Raises the shared credential-free persistence failure. */
function invalidPersistence(): never {
  throw new ProposalAuditPersistenceError();
}

/** Maps any malformed boundary value to the stable persistence failure. */
function mapPersistenceValidation<Value>(operation: () => Value): Value {
  try {
    return operation();
  } catch {
    return invalidPersistence();
  }
}

/** Requires a canonical UUIDv4 at the SQL boundary. */
function requireUuidV4(value: unknown): string {
  if (typeof value !== 'string') {
    return invalidPersistence();
  }
  const normalized = value.trim().toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalidPersistence();
  }
  return normalized;
}

/** Verifies that a persisted identifier remains within the requested tenant scope. */
function requireExpected(actual: string, expected: string): void {
  if (actual !== expected.toLowerCase()) {
    invalidPersistence();
  }
}

/** Accepts zero or one row and rejects impossible duplicate identities. */
function oneOrUndefined<Row>(rows: Row[]): Row | undefined {
  if (rows.length > 1) {
    invalidPersistence();
  }
  return rows[0];
}

/** Requires exactly one row for a successful state transition or replay. */
function exactlyOne<Row>(rows: Row[]): Row {
  return oneOrUndefined(rows) ?? invalidPersistence();
}

/** Matches only one PostgreSQL code and reviewed constraint name. */
function isNamedDatabaseError(
  error: unknown,
  code: string,
  constraint: string,
): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as PostgreSqlErrorShape;
  return candidate.code === code && candidate.constraint === constraint;
}

/** Validates and tenant-checks one untrusted proposal row. */
function parseProposalRow(
  row: ProposalAuditRow,
  expectedWorkspaceId: string,
  expectedProposalId?: string,
): ProposalAuditRecord {
  const record = mapPersistenceValidation(() =>
    validateProposalAuditRecord({
      proposal: {
        proposalId: row.proposal_id,
        workspaceId: row.workspace_id,
        summary: row.summary,
        rationale: row.rationale_json,
        operations: row.operations_json,
        requiresConfirmation: row.requires_confirmation,
        createdAt: row.created_at,
      },
      request: row.request_json,
      modelId: row.model_id,
      requestDigest: row.request_digest,
      contentDigest: row.content_digest,
      recordedAt: row.recorded_at,
    }),
  );
  requireExpected(record.proposal.workspaceId, expectedWorkspaceId);
  if (expectedProposalId) {
    requireExpected(record.proposal.proposalId, expectedProposalId);
  }
  return record;
}

/** Validates and tenant-checks one untrusted decision row. */
function parseDecisionRow(
  row: ProposalDecisionRow,
  expectedWorkspaceId: string,
  expectedProposalId?: string,
  expectedIdempotencyKey?: string,
): ProposalDecisionEvent {
  const value = {
    id: row.id,
    workspaceId: row.workspace_id,
    proposalId: row.proposal_id,
    proposalContentDigest: row.proposal_content_digest,
    actorId: row.actor_id,
    decision: row.decision_kind,
    ...(row.reason_text === null || row.reason_text === undefined
      ? {}
      : { reason: row.reason_text }),
    idempotencyKey: row.idempotency_key,
    decidedAt: row.decided_at,
    recordedAt: row.recorded_at,
  };
  const event = mapPersistenceValidation(() =>
    validateProposalDecisionEvent(value),
  );
  requireExpected(event.workspaceId, expectedWorkspaceId);
  if (expectedProposalId) {
    requireExpected(event.proposalId, expectedProposalId);
  }
  if (expectedIdempotencyKey) {
    requireExpected(event.idempotencyKey, expectedIdempotencyKey);
  }
  return event;
}

/** Maps malformed proposal input to the stable persistence error contract. */
function validateProposalInput(
  record: ProposalAuditRecord,
): ProposalAuditRecord {
  return mapPersistenceValidation(() => validateProposalAuditRecord(record));
}

/** Maps malformed decision input to the stable persistence error contract. */
function validateDecisionInput(
  event: ProposalDecisionEvent,
): ProposalDecisionEvent {
  return mapPersistenceValidation(() => validateProposalDecisionEvent(event));
}

/** Compares every immutable decision field relevant to exact idempotent replay. */
function sameDecisionPayload(
  persisted: ProposalDecisionEvent,
  attempted: ProposalDecisionEvent,
): boolean {
  return (
    persisted.proposalContentDigest === attempted.proposalContentDigest &&
    persisted.actorId === attempted.actorId &&
    persisted.decision === attempted.decision &&
    persisted.reason === attempted.reason &&
    persisted.decidedAt === attempted.decidedAt
  );
}

/** Parameterized, tenant-scoped PostgreSQL proposal audit repository. */
export class PostgresProposalAuditRepository implements ProposalAuditRepository {
  /** Creates the repository over one bounded parameterized SQL client. */
  constructor(private readonly client: ProposalAuditSqlClient) {}

  /** Executes SQL while replacing transport details with one stable failure. */
  private async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    try {
      return await this.client.query<Row>(text, values);
    } catch {
      throw new ProposalAuditPersistenceError();
    }
  }

  /** Persists one immutable tenant-scoped proposal revision. */
  async saveProposal(record: ProposalAuditRecord): Promise<void> {
    const safe = validateProposalInput(record);
    await this.query(
      `INSERT INTO ai.proposal_audit_records
        (proposal_id, workspace_id, model_id, request_json, request_digest,
         summary, rationale_json, operations_json, requires_confirmation,
         content_digest, created_at, recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        safe.proposal.proposalId,
        safe.proposal.workspaceId,
        safe.modelId,
        safe.request,
        safe.requestDigest,
        safe.proposal.summary,
        JSON.stringify(safe.proposal.rationale),
        JSON.stringify(safe.proposal.operations),
        safe.proposal.requiresConfirmation,
        safe.contentDigest,
        safe.proposal.createdAt,
        safe.recordedAt,
      ],
    );
  }

  /** Finds one tenant-scoped proposal revision with duplicate-row rejection. */
  async findProposal(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalAuditRecord | undefined> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeProposalId = requireUuidV4(proposalId);
    const result = await this.query<ProposalAuditRow>(
      `SELECT proposal_id, workspace_id, model_id, request_json,
              request_digest, summary, rationale_json, operations_json,
              requires_confirmation, content_digest, created_at, recorded_at
       FROM ai.proposal_audit_records
       WHERE workspace_id = $1 AND proposal_id = $2
       LIMIT 2`,
      [safeWorkspaceId, safeProposalId],
    );
    const row = oneOrUndefined(result.rows);
    return row
      ? parseProposalRow(row, safeWorkspaceId, safeProposalId)
      : undefined;
  }

  /** Lists tenant proposal evidence in deterministic creation order. */
  async listProposals(workspaceId: string): Promise<ProposalAuditRecord[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const result = await this.query<ProposalAuditRow>(
      `SELECT proposal_id, workspace_id, model_id, request_json,
              request_digest, summary, rationale_json, operations_json,
              requires_confirmation, content_digest, created_at, recorded_at
       FROM ai.proposal_audit_records
       WHERE workspace_id = $1
       ORDER BY created_at ASC, proposal_id ASC`,
      [safeWorkspaceId],
    );
    return result.rows.map((row) => parseProposalRow(row, safeWorkspaceId));
  }

  /** Appends one decision or returns an exact idempotent replay. */
  async appendDecision(
    event: ProposalDecisionEvent,
  ): Promise<ProposalDecisionEvent> {
    const safe = validateDecisionInput(event);
    let inserted: ProposalAuditSqlQueryResult<ProposalDecisionRow> | undefined;
    try {
      inserted = await this.client.query<ProposalDecisionRow>(
        `INSERT INTO ai.proposal_decision_events
          (id, workspace_id, proposal_id, proposal_content_digest, actor_id,
           decision_kind, reason_text, idempotency_key, decided_at, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, workspace_id, proposal_id, proposal_content_digest,
                   actor_id, decision_kind, reason_text, idempotency_key,
                   decided_at, recorded_at`,
        [
          safe.id,
          safe.workspaceId,
          safe.proposalId,
          safe.proposalContentDigest,
          safe.actorId,
          safe.decision,
          safe.reason ?? null,
          safe.idempotencyKey,
          safe.decidedAt,
          safe.recordedAt,
        ],
      );
    } catch (error) {
      if (isNamedDatabaseError(error, '23503', DIGEST_FOREIGN_KEY_CONSTRAINT)) {
        throw new ProposalDigestMismatchError();
      }
      if (!isNamedDatabaseError(error, '23505', IDEMPOTENCY_CONSTRAINT)) {
        throw new ProposalAuditPersistenceError();
      }
    }

    if (inserted) {
      return parseDecisionRow(
        exactlyOne(inserted.rows),
        safe.workspaceId,
        safe.proposalId,
        safe.idempotencyKey,
      );
    }

    const replay = await this.query<ProposalDecisionRow>(
      `SELECT id, workspace_id, proposal_id, proposal_content_digest,
              actor_id, decision_kind, reason_text, idempotency_key,
              decided_at, recorded_at
       FROM ai.proposal_decision_events
       WHERE workspace_id = $1
         AND proposal_id = $2
         AND idempotency_key = $3
       LIMIT 2`,
      [safe.workspaceId, safe.proposalId, safe.idempotencyKey],
    );
    const persisted = parseDecisionRow(
      exactlyOne(replay.rows),
      safe.workspaceId,
      safe.proposalId,
      safe.idempotencyKey,
    );
    if (!sameDecisionPayload(persisted, safe)) {
      throw new ProposalDecisionConflictError();
    }
    return persisted;
  }

  /** Lists append-only tenant decision history in deterministic order. */
  async listDecisions(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalDecisionEvent[]> {
    const safeWorkspaceId = requireUuidV4(workspaceId);
    const safeProposalId = requireUuidV4(proposalId);
    const result = await this.query<ProposalDecisionRow>(
      `SELECT id, workspace_id, proposal_id, proposal_content_digest,
              actor_id, decision_kind, reason_text, idempotency_key,
              decided_at, recorded_at
       FROM ai.proposal_decision_events
       WHERE workspace_id = $1 AND proposal_id = $2
       ORDER BY recorded_at ASC, id ASC`,
      [safeWorkspaceId, safeProposalId],
    );
    return result.rows.map((row) =>
      parseDecisionRow(row, safeWorkspaceId, safeProposalId),
    );
  }
}
