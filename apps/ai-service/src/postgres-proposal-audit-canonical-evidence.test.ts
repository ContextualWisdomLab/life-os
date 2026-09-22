import { describe, expect, it } from 'vitest';
import {
  createProposalAuditRecord,
  createProposalDecisionEvent,
} from './proposal-audit-domain';
import type { ProposalRequest } from './proposal-service';
import {
  PostgresProposalAuditRepository,
  ProposalAuditPersistenceError,
  type ProposalAuditSqlClient,
  type ProposalAuditSqlQueryResult,
} from './postgres-proposal-audit-repository';

const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TASK_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACTOR_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVENT_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const IDEMPOTENCY_KEY = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

class StaticProposalRowClient implements ProposalAuditSqlClient {
  constructor(private readonly row: Readonly<Record<string, unknown>>) {}

  async query<Row>(): Promise<ProposalAuditSqlQueryResult<Row>> {
    return { rows: [this.row as Row] };
  }
}

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

function uppercaseOneHexLetter(value: string): string {
  const index = value.search(/[a-f]/);
  if (index < 0) {
    throw new Error(
      'fixture requires at least one lowercase hexadecimal letter',
    );
  }
  return `${value.slice(0, index)}${value[index]!.toUpperCase()}${value.slice(index + 1)}`;
}

function canonicalRow(): Readonly<Record<string, unknown>> {
  const record = createProposalAuditRecord({
    proposal: {
      proposalId: PROPOSAL_ID,
      workspaceId: WORKSPACE_ID,
      summary: 'Verify canonical audit evidence.',
      rationale: ['Persisted audit evidence must remain byte-canonical.'],
      operations: [
        {
          kind: 'prioritize_item',
          targetId: TASK_ID,
          description: 'Keep the exact immutable evidence representation.',
        },
      ],
      requiresConfirmation: true,
      createdAt: '2026-08-04T00:00:00.000Z',
    },
    request: request(),
    modelId: 'rule-based-v1',
    recordedAt: '2026-08-04T00:00:01.000Z',
  });

  return {
    proposal_id: record.proposal.proposalId,
    workspace_id: record.proposal.workspaceId,
    model_id: record.modelId,
    request_json: record.request,
    request_digest: record.requestDigest,
    summary: record.proposal.summary,
    rationale_json: record.proposal.rationale,
    operations_json: record.proposal.operations,
    requires_confirmation: record.proposal.requiresConfirmation,
    content_digest: record.contentDigest,
    created_at: record.proposal.createdAt,
    recorded_at: record.recordedAt,
  };
}

function canonicalDecisionRow(): Readonly<Record<string, unknown>> {
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

  return {
    id: event.id,
    workspace_id: event.workspaceId,
    proposal_id: event.proposalId,
    proposal_content_digest: event.proposalContentDigest,
    actor_id: event.actorId,
    decision_kind: event.decision,
    reason_text: null,
    idempotency_key: event.idempotencyKey,
    decided_at: event.decidedAt,
    recorded_at: event.recordedAt,
  };
}

describe('PostgresProposalAuditRepository canonical durable evidence', () => {
  it('fails closed when PostgreSQL returns a recanonicalizable immutable proposal row', async () => {
    const canonical = canonicalRow();
    const aliases: Readonly<Record<string, unknown>>[] = [
      {
        ...canonical,
        proposal_id: (canonical.proposal_id as string).toUpperCase(),
      },
      {
        ...canonical,
        workspace_id: (canonical.workspace_id as string).toUpperCase(),
      },
      {
        ...canonical,
        request_digest: uppercaseOneHexLetter(
          canonical.request_digest as string,
        ),
      },
      {
        ...canonical,
        content_digest: uppercaseOneHexLetter(
          canonical.content_digest as string,
        ),
      },
      { ...canonical, created_at: '2026-08-04T09:00:00+09:00' },
      { ...canonical, recorded_at: '2026-08-04T09:00:01+09:00' },
    ];

    for (const row of aliases) {
      const repository = new PostgresProposalAuditRepository(
        new StaticProposalRowClient(row),
      );
      await expect(repository.listProposals(WORKSPACE_ID)).rejects.toThrow(
        ProposalAuditPersistenceError,
      );
    }
  });

  it('fails closed when PostgreSQL returns a recanonicalizable append-only decision row', async () => {
    const canonical = canonicalDecisionRow();
    const aliases: Readonly<Record<string, unknown>>[] = [
      { ...canonical, id: (canonical.id as string).toUpperCase() },
      {
        ...canonical,
        workspace_id: (canonical.workspace_id as string).toUpperCase(),
      },
      {
        ...canonical,
        proposal_id: (canonical.proposal_id as string).toUpperCase(),
      },
      {
        ...canonical,
        proposal_content_digest: uppercaseOneHexLetter(
          canonical.proposal_content_digest as string,
        ),
      },
      {
        ...canonical,
        actor_id: (canonical.actor_id as string).toUpperCase(),
      },
      {
        ...canonical,
        idempotency_key: (canonical.idempotency_key as string).toUpperCase(),
      },
      { ...canonical, decided_at: '2026-08-04T09:00:00+09:00' },
      { ...canonical, recorded_at: '2026-08-04T09:00:01+09:00' },
    ];

    for (const row of aliases) {
      const repository = new PostgresProposalAuditRepository(
        new StaticProposalRowClient(row),
      );
      await expect(
        repository.listDecisions(WORKSPACE_ID, PROPOSAL_ID),
      ).rejects.toThrow(ProposalAuditPersistenceError);
    }
  });
});
