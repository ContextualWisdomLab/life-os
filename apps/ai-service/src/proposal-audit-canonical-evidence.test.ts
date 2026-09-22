import { describe, expect, it } from 'vitest';
import type { AuditableProposal, ProposalRequest } from './proposal-service';
import {
  createProposalAuditRecord,
  createProposalDecisionEvent,
  ProposalAuditValidationError,
  validateProposalAuditRecord,
  validateProposalDecisionEvent,
} from './proposal-audit-domain';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TASK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTOR_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const IDEMPOTENCY_KEY = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

function request(): ProposalRequest {
  return {
    objective: 'Preserve immutable audit evidence exactly',
    context: [
      {
        id: TASK_ID,
        kind: 'task',
        title: 'Verify canonical persisted evidence',
        status: 'active',
      },
    ],
  };
}

function proposal(): AuditableProposal {
  return {
    proposalId: PROPOSAL_ID,
    workspaceId: WORKSPACE_ID,
    summary: 'Verify canonical audit evidence.',
    rationale: [
      'Persisted audit evidence must not be recanonicalized on read.',
    ],
    operations: [
      {
        kind: 'prioritize_item',
        targetId: TASK_ID,
        description: 'Keep the exact immutable evidence representation.',
      },
    ],
    requiresConfirmation: true,
    createdAt: '2026-08-04T00:00:00.000Z',
  };
}

function uppercaseOneHexLetter(value: string): string {
  const index = value.search(/[a-f]/);
  if (index < 0) {
    throw new Error(
      'fixture requires at least one lowercase hexadecimal letter',
    );
  }
  return `${value.slice(0, index)}${value[index]!.toUpperCase()}${value.slice(index + 1)}`;
}

describe('proposal audit canonical durable evidence', () => {
  it('rejects aliases of persisted immutable proposal evidence instead of recanonicalizing them', () => {
    const record = createProposalAuditRecord({
      proposal: proposal(),
      request: request(),
      modelId: 'rule-based-v1',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });

    const aliases: unknown[] = [
      {
        ...record,
        proposal: {
          ...record.proposal,
          proposalId: record.proposal.proposalId.toUpperCase(),
        },
      },
      {
        ...record,
        proposal: {
          ...record.proposal,
          workspaceId: record.proposal.workspaceId.toUpperCase(),
        },
      },
      {
        ...record,
        requestDigest: uppercaseOneHexLetter(record.requestDigest),
      },
      {
        ...record,
        contentDigest: uppercaseOneHexLetter(record.contentDigest),
      },
      {
        ...record,
        proposal: {
          ...record.proposal,
          createdAt: '2026-08-04T09:00:00+09:00',
        },
      },
      {
        ...record,
        recordedAt: '2026-08-04T09:00:01+09:00',
      },
    ];

    for (const alias of aliases) {
      expect(() => validateProposalAuditRecord(alias)).toThrow(
        ProposalAuditValidationError,
      );
    }
  });

  it('rejects aliases of persisted append-only decision evidence instead of recanonicalizing them', () => {
    const event = createProposalDecisionEvent({
      id: EVENT_ID,
      workspaceId: WORKSPACE_ID,
      proposalId: PROPOSAL_ID,
      proposalContentDigest: 'a'.repeat(64),
      actorId: ACTOR_ID,
      decision: 'accepted',
      idempotencyKey: IDEMPOTENCY_KEY,
      decidedAt: '2026-08-04T00:00:00.000Z',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });

    const aliases: unknown[] = [
      { ...event, id: event.id.toUpperCase() },
      { ...event, workspaceId: event.workspaceId.toUpperCase() },
      { ...event, proposalId: event.proposalId.toUpperCase() },
      { ...event, actorId: event.actorId.toUpperCase() },
      { ...event, idempotencyKey: event.idempotencyKey.toUpperCase() },
      {
        ...event,
        proposalContentDigest: event.proposalContentDigest.toUpperCase(),
      },
      { ...event, decidedAt: '2026-08-04T09:00:00+09:00' },
      { ...event, recordedAt: '2026-08-04T09:00:01+09:00' },
    ];

    for (const alias of aliases) {
      expect(() => validateProposalDecisionEvent(alias)).toThrow(
        ProposalAuditValidationError,
      );
    }
  });
});
