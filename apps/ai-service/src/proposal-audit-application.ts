import { randomUUID } from 'node:crypto';
import type {
  ProposalAuditRecord,
  ProposalAuditRepository,
  ProposalDecisionEvent,
} from './proposal-audit-domain';
import {
  createProposalAuditRecord,
  createProposalDecisionEvent,
  ProposalAuditValidationError,
} from './proposal-audit-domain';
import {
  type AuditableProposal,
  type ProposalRequest,
  ProposalService,
} from './proposal-service';
import { ProposalDigestMismatchError } from './postgres-proposal-audit-repository';

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256_PATTERN = /^[0-9a-f]{64}$/;
const RFC_3339_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAXIMUM_REASON_LENGTH = 1_000;

/** Untrusted decision payload accepted by the versioned HTTP boundary. */
export interface ProposalDecisionRequest {
  readonly expectedContentDigest: string;
  readonly idempotencyKey: string;
  readonly decision: 'accepted' | 'rejected';
  readonly reason?: string;
  readonly decidedAt: string;
}

export type ProposalAuditClock = () => Date;
export type ProposalDecisionIdFactory = () => string;

/** Stable tenant-scoped absence used by bounded HTTP problem mapping. */
export class ProposalAuditNotFoundError extends Error {
  constructor() {
    super('Proposal audit record was not found');
    this.name = 'ProposalAuditNotFoundError';
  }
}

function invalid(): never {
  throw new ProposalAuditValidationError();
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid();
  }
  return value as Readonly<Record<string, unknown>>;
}

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

function requireUuidV4(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!UUID_V4_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireDigest(value: unknown): string {
  const normalized = requireString(value, 64).toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    return invalid();
  }
  return normalized;
}

function requireTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC_3339_TIMESTAMP_PATTERN.test(value)) {
    return invalid();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return invalid();
  }
  return parsed.toISOString();
}

function now(clock: ProposalAuditClock): string {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return invalid();
  }
  return value.toISOString();
}

/** Strictly validates a decision body without accepting tenant or actor fields. */
export function validateProposalDecisionRequest(
  value: unknown,
): ProposalDecisionRequest {
  const record = requireRecord(value);
  const hasReason = Object.hasOwn(record, 'reason');
  requireExactKeys(
    record,
    hasReason
      ? [
          'expectedContentDigest',
          'idempotencyKey',
          'decision',
          'reason',
          'decidedAt',
        ]
      : [
          'expectedContentDigest',
          'idempotencyKey',
          'decision',
          'decidedAt',
        ],
  );
  const decision = record.decision;
  if (decision !== 'accepted' && decision !== 'rejected') {
    return invalid();
  }
  const request = {
    expectedContentDigest: requireDigest(record.expectedContentDigest),
    idempotencyKey: requireUuidV4(record.idempotencyKey),
    decision,
    decidedAt: requireTimestamp(record.decidedAt),
  };
  return Object.freeze(
    hasReason
      ? {
          ...request,
          reason: requireString(record.reason, MAXIMUM_REASON_LENGTH),
        }
      : request,
  );
}

/**
 * Orchestrates inert proposal generation and append-only audit persistence.
 *
 * The application receives only the proposal model and the audit repository. It
 * has no command bus, planning repository, calendar adapter, or other
 * write-capable dependency for user-owned data.
 */
export class ProposalAuditApplication {
  constructor(
    private readonly proposalService: ProposalService,
    private readonly repository: ProposalAuditRepository,
    private readonly modelId: string = 'rule-based-v1',
    private readonly clock: ProposalAuditClock = () => new Date(),
    private readonly decisionIdFactory: ProposalDecisionIdFactory = randomUUID,
  ) {}

  async generateProposal(
    workspaceId: string,
    request: ProposalRequest,
  ): Promise<AuditableProposal> {
    const proposal = await this.proposalService.generateProposal(
      workspaceId,
      request,
    );
    const record = createProposalAuditRecord({
      proposal,
      request,
      modelId: this.modelId,
      recordedAt: now(this.clock),
    });
    await this.repository.saveProposal(record);
    return record.proposal;
  }

  async listProposals(workspaceId: string): Promise<ProposalAuditRecord[]> {
    return await this.repository.listProposals(requireUuidV4(workspaceId));
  }

  async findProposal(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalAuditRecord> {
    const record = await this.repository.findProposal(
      requireUuidV4(workspaceId),
      requireUuidV4(proposalId),
    );
    if (!record) {
      throw new ProposalAuditNotFoundError();
    }
    return record;
  }

  async listDecisions(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalDecisionEvent[]> {
    const record = await this.findProposal(workspaceId, proposalId);
    return await this.repository.listDecisions(
      record.proposal.workspaceId,
      record.proposal.proposalId,
    );
  }

  async appendDecision(
    workspaceId: string,
    proposalId: string,
    actorId: string,
    request: ProposalDecisionRequest,
  ): Promise<ProposalDecisionEvent> {
    const safeRequest = validateProposalDecisionRequest(request);
    const record = await this.findProposal(workspaceId, proposalId);
    if (safeRequest.expectedContentDigest !== record.contentDigest) {
      throw new ProposalDigestMismatchError();
    }
    const event = createProposalDecisionEvent({
      id: this.decisionIdFactory(),
      workspaceId: record.proposal.workspaceId,
      proposalId: record.proposal.proposalId,
      proposalContentDigest: safeRequest.expectedContentDigest,
      actorId: requireUuidV4(actorId),
      decision: safeRequest.decision,
      ...(safeRequest.reason === undefined
        ? {}
        : { reason: safeRequest.reason }),
      idempotencyKey: safeRequest.idempotencyKey,
      decidedAt: safeRequest.decidedAt,
      recordedAt: now(this.clock),
    });
    return await this.repository.appendDecision(event);
  }
}
