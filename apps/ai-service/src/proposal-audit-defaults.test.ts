import { describe, expect, it } from 'vitest';
import { ProposalAuditApplication } from './proposal-audit-application';
import type {
  ProposalAuditRecord,
  ProposalAuditRepository,
  ProposalDecisionEvent,
} from './proposal-audit-domain';
import { ProposalService, RuleBasedProposalModel } from './proposal-service';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR_ID = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const IDEMPOTENCY_KEY = '55555555-5555-4555-8555-555555555555';

class DefaultSeamRepository implements ProposalAuditRepository {
  record: ProposalAuditRecord | undefined;
  decision: ProposalDecisionEvent | undefined;

  async saveProposal(record: ProposalAuditRecord): Promise<void> {
    this.record = record;
  }

  async findProposal(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalAuditRecord | undefined> {
    return this.record?.proposal.workspaceId === workspaceId &&
      this.record.proposal.proposalId === proposalId
      ? this.record
      : undefined;
  }

  async listProposals(workspaceId: string): Promise<ProposalAuditRecord[]> {
    return this.record?.proposal.workspaceId === workspaceId ? [this.record] : [];
  }

  async appendDecision(
    event: ProposalDecisionEvent,
  ): Promise<ProposalDecisionEvent> {
    this.decision = event;
    return event;
  }

  async listDecisions(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalDecisionEvent[]> {
    return this.decision?.workspaceId === workspaceId &&
      this.decision.proposalId === proposalId
      ? [this.decision]
      : [];
  }
}

describe('proposal audit default seams', () => {
  it('uses production wall-clock and UUID factories when no seams are injected', async () => {
    const repository = new DefaultSeamRepository();
    const service = new ProposalService(
      new RuleBasedProposalModel(),
      () => new Date('2026-08-04T00:00:00.000Z'),
      () => PROPOSAL_ID,
    );
    const application = new ProposalAuditApplication(service, repository);

    await application.generateProposal(WORKSPACE_ID, {
      objective: 'Verify production defaults',
      context: [
        {
          id: TASK_ID,
          kind: 'task',
          title: 'Exercise default seams',
          status: 'active',
        },
      ],
    });
    const record = repository.record;
    expect(record).toBeDefined();
    expect(Number.isNaN(Date.parse(record!.recordedAt))).toBe(false);

    const decision = await application.appendDecision(
      WORKSPACE_ID,
      PROPOSAL_ID,
      ACTOR_ID,
      {
        expectedContentDigest: record!.contentDigest,
        idempotencyKey: IDEMPOTENCY_KEY,
        decision: 'accepted',
        decidedAt: '2026-08-04T00:00:02.000Z',
      },
    );

    expect(decision.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(Number.isNaN(Date.parse(decision.recordedAt))).toBe(false);
  });
});
