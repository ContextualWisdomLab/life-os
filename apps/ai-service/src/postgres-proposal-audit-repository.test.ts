import { describe, expect, it } from 'vitest';
import type { AuditableProposal, ProposalRequest } from './proposal-service';
import {
  createProposalAuditRecord,
  createProposalDecisionEvent,
  type ProposalAuditRecord,
  type ProposalDecisionEvent,
} from './proposal-audit-domain';
import {
  ProposalAuditPersistenceError,
  type ProposalAuditSqlClient,
  type ProposalAuditSqlQueryResult,
  ProposalDecisionConflictError,
  ProposalDigestMismatchError,
  PostgresProposalAuditRepository,
} from './postgres-proposal-audit-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const TASK_ID = '33333333-3333-4333-8333-333333333333';
const ACTOR_ID = '44444444-4444-4444-8444-444444444444';
const EVENT_ID = '55555555-5555-4555-8555-555555555555';
const IDEMPOTENCY_KEY = '66666666-6666-4666-8666-666666666666';

interface QueryCall {
  text: string;
  values: readonly unknown[];
}

interface ErrorResponse {
  error: unknown;
}

type QueryResponse = unknown[] | ErrorResponse;

class RecordingSqlClient implements ProposalAuditSqlClient {
  readonly calls: QueryCall[] = [];
  private readonly responses: QueryResponse[];

  constructor(...responses: QueryResponse[]) {
    this.responses = [...responses];
  }

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    this.calls.push({ text, values });
    const response = this.responses.shift() ?? [];
    if (!Array.isArray(response)) {
      throw response.error;
    }
    return { rows: response as Row[] };
  }
}

function request(): ProposalRequest {
  return {
    objective: 'Ship a reviewable increment',
    context: [
      {
        id: TASK_ID,
        kind: 'task',
        title: 'Verify the release candidate',
        status: 'active',
      },
    ],
  };
}

function proposal(): AuditableProposal {
  return {
    proposalId: PROPOSAL_ID,
    workspaceId: WORKSPACE_ID,
    summary: 'Prioritize release verification.',
    rationale: ['The release candidate is the active critical path.'],
    operations: [
      {
        kind: 'prioritize_item',
        targetId: TASK_ID,
        description: 'Prioritize release verification for explicit review.',
      },
    ],
    requiresConfirmation: true,
    createdAt: '2026-08-04T00:00:00.000Z',
  };
}

function auditRecord(): ProposalAuditRecord {
  return createProposalAuditRecord({
    proposal: proposal(),
    request: request(),
    modelId: 'rule-based-v1',
    recordedAt: '2026-08-04T00:00:01.000Z',
  });
}

function decisionEvent(
  overrides: Partial<ProposalDecisionEvent> = {},
): ProposalDecisionEvent {
  const audit = auditRecord();
  return createProposalDecisionEvent({
    id: overrides.id ?? EVENT_ID,
    workspaceId: overrides.workspaceId ?? WORKSPACE_ID,
    proposalId: overrides.proposalId ?? PROPOSAL_ID,
    proposalContentDigest:
      overrides.proposalContentDigest ?? audit.contentDigest,
    actorId: overrides.actorId ?? ACTOR_ID,
    decision: overrides.decision ?? 'accepted',
    ...(overrides.reason === undefined ? {} : { reason: overrides.reason }),
    idempotencyKey: overrides.idempotencyKey ?? IDEMPOTENCY_KEY,
    decidedAt: overrides.decidedAt ?? '2026-08-04T00:00:02.000Z',
    recordedAt: overrides.recordedAt ?? '2026-08-04T00:00:03.000Z',
  });
}

function proposalRow(overrides: Record<string, unknown> = {}) {
  const audit = auditRecord();
  return {
    proposal_id: PROPOSAL_ID,
    workspace_id: WORKSPACE_ID,
    model_id: audit.modelId,
    request_json: audit.request,
    request_digest: audit.requestDigest,
    summary: audit.proposal.summary,
    rationale_json: audit.proposal.rationale,
    operations_json: audit.proposal.operations,
    requires_confirmation: true,
    content_digest: audit.contentDigest,
    created_at: new Date(audit.proposal.createdAt),
    recorded_at: new Date(audit.recordedAt),
    ...overrides,
  };
}

function decisionRow(overrides: Record<string, unknown> = {}) {
  const event = decisionEvent();
  return {
    id: event.id,
    workspace_id: event.workspaceId,
    proposal_id: event.proposalId,
    proposal_content_digest: event.proposalContentDigest,
    actor_id: event.actorId,
    decision_kind: event.decision,
    reason_text: null,
    idempotency_key: event.idempotencyKey,
    decided_at: new Date(event.decidedAt),
    recorded_at: new Date(event.recordedAt),
    ...overrides,
  };
}

describe('PostgresProposalAuditRepository', () => {
  it('binds every proposal value without exposing a user-data mutation schema', async () => {
    const client = new RecordingSqlClient([]);
    const repository = new PostgresProposalAuditRepository(client);
    const audit = auditRecord();

    await repository.saveProposal(audit);

    expect(client.calls[0]?.text).toContain(
      'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
    );
    expect(client.calls[0]?.text).not.toMatch(/planning\.|habit\.|identity\./);
    expect(client.calls[0]?.values).toEqual([
      PROPOSAL_ID,
      WORKSPACE_ID,
      'rule-based-v1',
      audit.request,
      audit.requestDigest,
      audit.proposal.summary,
      JSON.stringify(audit.proposal.rationale),
      JSON.stringify(audit.proposal.operations),
      true,
      audit.contentDigest,
      audit.proposal.createdAt,
      audit.recordedAt,
    ]);
  });

  it('fails closed before SQL when runtime identifiers are non-string', async () => {
    const client = new RecordingSqlClient();
    const repository = new PostgresProposalAuditRepository(client);

    await expect(
      repository.listProposals(42 as unknown as string),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      repository.findProposal(WORKSPACE_ID, null as unknown as string),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    expect(client.calls).toHaveLength(0);
  });

  it('uses tenant predicates, verifies digests, and returns stable ordering', async () => {
    const client = new RecordingSqlClient([proposalRow()], [proposalRow()]);
    const repository = new PostgresProposalAuditRepository(client);

    await expect(
      repository.findProposal(WORKSPACE_ID, PROPOSAL_ID),
    ).resolves.toEqual(auditRecord());
    await expect(repository.listProposals(WORKSPACE_ID)).resolves.toEqual([
      auditRecord(),
    ]);

    expect(client.calls[0]?.text).toContain(
      'WHERE workspace_id = $1 AND proposal_id = $2',
    );
    expect(client.calls[0]?.text).toContain('LIMIT 2');
    expect(client.calls[0]?.values).toEqual([WORKSPACE_ID, PROPOSAL_ID]);
    expect(client.calls[1]?.text).toContain(
      'ORDER BY created_at ASC, proposal_id ASC',
    );
  });

  it('fails closed on tampered or cross-tenant proposal rows', async () => {
    const tamperedClient = new RecordingSqlClient([
      proposalRow({ content_digest: '0'.repeat(64) }),
    ]);
    const crossTenantClient = new RecordingSqlClient([
      proposalRow({ workspace_id: OTHER_WORKSPACE_ID }),
    ]);

    await expect(
      new PostgresProposalAuditRepository(tamperedClient).listProposals(
        WORKSPACE_ID,
      ),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
    await expect(
      new PostgresProposalAuditRepository(crossTenantClient).findProposal(
        WORKSPACE_ID,
        PROPOSAL_ID,
      ),
    ).rejects.toBeInstanceOf(ProposalAuditPersistenceError);
  });

  it('returns an inserted decision and recovers an exact replay', async () => {
    const event = decisionEvent();
    const insertedClient = new RecordingSqlClient([decisionRow()]);
    await expect(
      new PostgresProposalAuditRepository(insertedClient).appendDecision(event),
    ).resolves.toEqual(event);

    const replayClient = new RecordingSqlClient(
      {
        error: {
          code: '23505',
          constraint: 'proposal_decision_events_idempotency_unique',
        },
      },
      [decisionRow()],
    );
    await expect(
      new PostgresProposalAuditRepository(replayClient).appendDecision(
        decisionEvent({
          id: '77777777-7777-4777-8777-777777777777',
          recordedAt: '2026-08-04T00:00:04.000Z',
        }),
      ),
    ).resolves.toEqual(event);
    expect(replayClient.calls[1]?.values).toEqual([
      WORKSPACE_ID,
      PROPOSAL_ID,
      IDEMPOTENCY_KEY,
    ]);
  });

  it('rejects stale digests and conflicting idempotency replays', async () => {
    const staleClient = new RecordingSqlClient({
      error: {
        code: '23503',
        constraint: 'proposal_decision_events_proposal_digest_foreign',
      },
    });
    await expect(
      new PostgresProposalAuditRepository(staleClient).appendDecision(
        decisionEvent(),
      ),
    ).rejects.toBeInstanceOf(ProposalDigestMismatchError);

    const conflictClient = new RecordingSqlClient(
      {
        error: {
          code: '23505',
          constraint: 'proposal_decision_events_idempotency_unique',
        },
      },
      [decisionRow()],
    );
    await expect(
      new PostgresProposalAuditRepository(conflictClient).appendDecision(
        decisionEvent({ decision: 'rejected' }),
      ),
    ).rejects.toBeInstanceOf(ProposalDecisionConflictError);
  });

  it('maps unrelated database errors to a credential-free failure', async () => {
    const client = new RecordingSqlClient({
      error: {
        code: '23505',
        constraint: 'proposal_decision_events_pkey',
        detail: 'password=secret',
      },
    });

    await expect(
      new PostgresProposalAuditRepository(client).appendDecision(
        decisionEvent(),
      ),
    ).rejects.toEqual(new ProposalAuditPersistenceError());
  });

  it('lists decisions with deterministic tenant-scoped ordering', async () => {
    const client = new RecordingSqlClient([decisionRow()]);
    const repository = new PostgresProposalAuditRepository(client);

    await expect(
      repository.listDecisions(WORKSPACE_ID, PROPOSAL_ID),
    ).resolves.toEqual([decisionEvent()]);
    expect(client.calls[0]?.text).toContain(
      'WHERE workspace_id = $1 AND proposal_id = $2',
    );
    expect(client.calls[0]?.text).toContain('ORDER BY recorded_at ASC, id ASC');
  });
});
