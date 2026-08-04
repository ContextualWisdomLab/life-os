import { createHash } from 'node:crypto';
import type {
  AuditableProposal,
  ProposalOperation,
  ProposalRequest,
} from './proposal-service';
import { validateProposalRequest } from './proposal-service';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAXIMUM_TEXT_LENGTH = 1_000;
const MAXIMUM_MODEL_ID_LENGTH = 200;
const MAXIMUM_RATIONALE_ITEMS = 20;
const MAXIMUM_OPERATIONS = 20;

/** Immutable proposal evidence persisted independently from user-owned data. */
export interface ProposalAuditRecord {
  readonly proposal: AuditableProposal;
  readonly request: ProposalRequest;
  readonly modelId: string;
  readonly requestDigest: string;
  readonly contentDigest: string;
  readonly recordedAt: string;
}

/** Explicit append-only decision about one immutable proposal revision. */
export interface ProposalDecisionEvent {
  readonly id: string;
  readonly workspaceId: string;
  readonly proposalId: string;
  readonly proposalContentDigest: string;
  readonly actorId: string;
  readonly decision: 'accepted' | 'rejected';
  readonly reason?: string;
  readonly idempotencyKey: string;
  readonly decidedAt: string;
  readonly recordedAt: string;
}

/** Asynchronous audit-only persistence contract with no user-data mutation API. */
export interface ProposalAuditRepository {
  /** Persists one immutable proposal revision and its canonical provenance. */
  saveProposal(record: ProposalAuditRecord): Promise<void>;
  /** Finds one tenant-owned immutable proposal revision. */
  findProposal(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalAuditRecord | undefined>;
  /** Lists deterministic proposal evidence for one workspace. */
  listProposals(workspaceId: string): Promise<ProposalAuditRecord[]>;
  /** Appends or exactly replays one immutable decision event. */
  appendDecision(event: ProposalDecisionEvent): Promise<ProposalDecisionEvent>;
  /** Lists append-only decision history for one tenant-owned proposal. */
  listDecisions(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalDecisionEvent[]>;
}

/** Stable failure for malformed proposal-audit input or persisted evidence. */
export class ProposalAuditValidationError extends Error {
  /** Creates a stable credential-free audit validation failure. */
  constructor() {
    super('Proposal audit evidence is invalid');
    this.name = 'ProposalAuditValidationError';
  }
}

/** Raised when a decision references a stale or unknown proposal digest. */
export class ProposalDigestMismatchError extends Error {
  /** Creates a stable conflict representing an immutable revision mismatch. */
  constructor() {
    super('Proposal content digest does not match persisted evidence');
    this.name = 'ProposalDigestMismatchError';
  }
}

/** Raises the shared bounded audit validation failure. */
function invalid(): never {
  throw new ProposalAuditValidationError();
}

/** Requires an object-shaped untrusted or persisted value. */
function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

/** Requires one exact closed set of object fields. */
function requireExactKeys(
  record: Readonly<Record<string, unknown>>,
  expectedKeys: readonly string[],
): void {
  const expected = new Set(expectedKeys);
  const actual = Object.keys(record);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    invalid();
  }
}

/** Requires one trimmed non-empty string within an explicit maximum length. */
function requireString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string') {
    return invalid();
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    return invalid();
  }
  return normalized;
}

/** Requires and canonicalizes one opaque UUIDv4 identifier. */
function requireUuidV4(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

/** Requires and canonicalizes one SHA-256 hexadecimal digest. */
function requireDigest(value: unknown): string {
  const digest = requireString(value, 64).toLowerCase();
  if (!SHA_256_PATTERN.test(digest)) {
    return invalid();
  }
  return digest;
}

/** Requires a valid date or RFC 3339 timestamp and normalizes it to UTC. */
function requireTimestamp(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return invalid();
    }
    return value.toISOString();
  }
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    return invalid();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return invalid();
  }
  return parsed.toISOString();
}

/** Revalidates one proposal request and maps generator failures to audit validation. */
function validateRequest(value: unknown): ProposalRequest {
  try {
    return validateProposalRequest(value);
  } catch {
    return invalid();
  }
}

/** Revalidates one inert proposed operation for immutable evidence. */
function validateOperation(value: unknown): ProposalOperation {
  const record = requireRecord(value);
  const hasTargetId = Object.hasOwn(record, 'targetId');
  requireExactKeys(
    record,
    hasTargetId ? ['kind', 'description', 'targetId'] : ['kind', 'description'],
  );
  const kind = record.kind;
  if (
    kind !== 'create_task' &&
    kind !== 'prioritize_item' &&
    kind !== 'schedule_item'
  ) {
    return invalid();
  }
  const description = requireString(record.description, MAXIMUM_TEXT_LENGTH);
  if (!hasTargetId) {
    return Object.freeze({ kind, description });
  }
  return Object.freeze({
    kind,
    description,
    targetId: requireUuidV4(record.targetId),
  });
}

/** Revalidates one immutable inert proposal and its bounded nested fields. */
function validateProposal(value: unknown): AuditableProposal {
  const record = requireRecord(value);
  requireExactKeys(record, [
    'proposalId',
    'workspaceId',
    'summary',
    'rationale',
    'operations',
    'requiresConfirmation',
    'createdAt',
  ]);
  if (
    !Array.isArray(record.rationale) ||
    record.rationale.length === 0 ||
    record.rationale.length > MAXIMUM_RATIONALE_ITEMS ||
    !Array.isArray(record.operations) ||
    record.operations.length === 0 ||
    record.operations.length > MAXIMUM_OPERATIONS ||
    record.requiresConfirmation !== true
  ) {
    return invalid();
  }
  return Object.freeze({
    proposalId: requireUuidV4(record.proposalId),
    workspaceId: requireUuidV4(record.workspaceId),
    summary: requireString(record.summary, MAXIMUM_TEXT_LENGTH),
    rationale: Object.freeze(
      record.rationale.map((item) => requireString(item, MAXIMUM_TEXT_LENGTH)),
    ),
    operations: Object.freeze(record.operations.map(validateOperation)),
    requiresConfirmation: true,
    createdAt: requireTimestamp(record.createdAt),
  });
}

/** Projects one validated operation into deterministic digest field order. */
function canonicalOperation(
  operation: ProposalOperation,
): Readonly<Record<string, string>> {
  return operation.targetId === undefined
    ? {
        kind: operation.kind,
        description: operation.description,
      }
    : {
        kind: operation.kind,
        description: operation.description,
        targetId: operation.targetId,
      };
}

/** Computes a lowercase SHA-256 digest over canonical JSON evidence. */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** Computes the canonical digest for one tenant-scoped proposal request. */
export function computeProposalRequestDigest(
  workspaceId: string,
  request: ProposalRequest,
): string {
  const safeWorkspaceId = requireUuidV4(workspaceId);
  const safeRequest = validateRequest(request);
  return digest({
    workspaceId: safeWorkspaceId,
    objective: safeRequest.objective,
    context: safeRequest.context.map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      status: item.status,
    })),
  });
}

/** Computes the canonical digest for immutable proposal content and provenance. */
export function computeProposalContentDigest(
  proposal: AuditableProposal,
  modelId: string,
  requestDigest: string,
): string {
  const safeProposal = validateProposal(proposal);
  const safeModelId = requireString(modelId, MAXIMUM_MODEL_ID_LENGTH);
  const safeRequestDigest = requireDigest(requestDigest);
  return digest({
    proposalId: safeProposal.proposalId,
    workspaceId: safeProposal.workspaceId,
    modelId: safeModelId,
    requestDigest: safeRequestDigest,
    summary: safeProposal.summary,
    rationale: [...safeProposal.rationale],
    operations: safeProposal.operations.map(canonicalOperation),
    requiresConfirmation: true,
    createdAt: safeProposal.createdAt,
  });
}

/** Creates a deeply validated, integrity-protected proposal audit record. */
export function createProposalAuditRecord(input: {
  proposal: AuditableProposal;
  request: ProposalRequest;
  modelId: string;
  recordedAt: string;
}): ProposalAuditRecord {
  const proposal = validateProposal(input.proposal);
  const request = validateRequest(input.request);
  const modelId = requireString(input.modelId, MAXIMUM_MODEL_ID_LENGTH);
  const requestDigest = computeProposalRequestDigest(
    proposal.workspaceId,
    request,
  );
  const contentDigest = computeProposalContentDigest(
    proposal,
    modelId,
    requestDigest,
  );
  return Object.freeze({
    proposal,
    request,
    modelId,
    requestDigest,
    contentDigest,
    recordedAt: requireTimestamp(input.recordedAt),
  });
}

/** Validates persisted proposal evidence and verifies both canonical digests. */
export function validateProposalAuditRecord(
  value: unknown,
): ProposalAuditRecord {
  const record = requireRecord(value);
  requireExactKeys(record, [
    'proposal',
    'request',
    'modelId',
    'requestDigest',
    'contentDigest',
    'recordedAt',
  ]);
  const verified = createProposalAuditRecord({
    proposal: validateProposal(record.proposal),
    request: validateRequest(record.request),
    modelId: requireString(record.modelId, MAXIMUM_MODEL_ID_LENGTH),
    recordedAt: requireTimestamp(record.recordedAt),
  });
  if (
    verified.requestDigest !== requireDigest(record.requestDigest) ||
    verified.contentDigest !== requireDigest(record.contentDigest)
  ) {
    return invalid();
  }
  return verified;
}

/** Creates one validated append-only proposal decision event. */
export function createProposalDecisionEvent(input: {
  id: string;
  workspaceId: string;
  proposalId: string;
  proposalContentDigest: string;
  actorId: string;
  decision: 'accepted' | 'rejected';
  reason?: string;
  idempotencyKey: string;
  decidedAt: string;
  recordedAt: string;
}): ProposalDecisionEvent {
  if (input.decision !== 'accepted' && input.decision !== 'rejected') {
    return invalid();
  }
  const reason =
    input.reason === undefined
      ? undefined
      : requireString(input.reason, MAXIMUM_TEXT_LENGTH);
  const event = {
    id: requireUuidV4(input.id),
    workspaceId: requireUuidV4(input.workspaceId),
    proposalId: requireUuidV4(input.proposalId),
    proposalContentDigest: requireDigest(input.proposalContentDigest),
    actorId: requireUuidV4(input.actorId),
    decision: input.decision,
    idempotencyKey: requireUuidV4(input.idempotencyKey),
    decidedAt: requireTimestamp(input.decidedAt),
    recordedAt: requireTimestamp(input.recordedAt),
  };
  return Object.freeze(
    reason === undefined ? event : { ...event, reason },
  ) as ProposalDecisionEvent;
}

/** Validates an untrusted or persisted decision event. */
export function validateProposalDecisionEvent(
  value: unknown,
): ProposalDecisionEvent {
  const record = requireRecord(value);
  const hasReason = Object.hasOwn(record, 'reason');
  requireExactKeys(
    record,
    hasReason
      ? [
          'id',
          'workspaceId',
          'proposalId',
          'proposalContentDigest',
          'actorId',
          'decision',
          'reason',
          'idempotencyKey',
          'decidedAt',
          'recordedAt',
        ]
      : [
          'id',
          'workspaceId',
          'proposalId',
          'proposalContentDigest',
          'actorId',
          'decision',
          'idempotencyKey',
          'decidedAt',
          'recordedAt',
        ],
  );
  return createProposalDecisionEvent({
    id: requireUuidV4(record.id),
    workspaceId: requireUuidV4(record.workspaceId),
    proposalId: requireUuidV4(record.proposalId),
    proposalContentDigest: requireDigest(record.proposalContentDigest),
    actorId: requireUuidV4(record.actorId),
    decision:
      record.decision === 'accepted' || record.decision === 'rejected'
        ? record.decision
        : invalid(),
    ...(hasReason
      ? { reason: requireString(record.reason, MAXIMUM_TEXT_LENGTH) }
      : {}),
    idempotencyKey: requireUuidV4(record.idempotencyKey),
    decidedAt: requireTimestamp(record.decidedAt),
    recordedAt: requireTimestamp(record.recordedAt),
  });
}
