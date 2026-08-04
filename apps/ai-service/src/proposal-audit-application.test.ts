import { describe, expect, it } from 'vitest';
import {
  ProposalAuditApplication,
  ProposalAuditNotFoundError,
  validateProposalDecisionRequest,
} from './proposal-audit-application';
import type {
  ProposalAuditRecord,
  ProposalAuditRepository,
  ProposalDecisionEvent,
} from './proposal-audit-domain';
import { ProposalAuditValidationError } from './proposal-audit-domain';
import { ProposalService, RuleBasedProposalModel } from './proposal-service';
import { ProposalDigestMismatchError } from './postgres-proposal-audit-repository';

const WORKSPACE_ID = '43eab0ee-0f7b-4c7f-9331-b133f2647675';
const OTHER_WORKSPACE_ID = '7a948ba8-982f-454f-9e5f-4ac45a7d32fa';
const TASK_ID = 'e29c36af-999a-407f-9ca9-cfe194ab51f4';
const PROPOSAL_ID = 'aedcb1d1-cc60-42c6-9357-ec90821fce1b';
const ACTOR_ID = '8419e53d-2d1c-4cfb-970c-4af578ad5f1f';
const DECISION_ID = 'ddcad130-1d19-4e40-818c-da1a4d2ad3ce';
const IDEMPOTENCY_KEY = '9969dbbe-8674-4f83-8675-3fe44d99899a';

class InMemoryProposalAuditRepository implements ProposalAuditRepository {
  readonly records: ProposalAuditRecord[] = [];
  readonly decisions: ProposalDecisionEvent[] = [];

  async saveProposal(record: ProposalAuditRecord): Promise<void> {
    this.records.push(record);
  }

  async findProposal(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalAuditRecord | undefined> {
    return this.records.find(
      (record) =>
        record.proposal.workspaceId === workspaceId &&
        record.proposal.proposalId === proposalId,
    );
  }

  async listProposals(workspaceId: string): Promise<ProposalAuditRecord[]> {
    return this.records.filter(
      (record) => record.proposal.workspaceId === workspaceId,
    );
  }

  async appendDecision(
    event: ProposalDecisionEvent,
  ): Promise<ProposalDecisionEvent> {
    this.decisions.push(event);
    return event;
  }

  async listDecisions(
    workspaceId: string,
    proposalId: string,
  ): Promise<ProposalDecisionEvent[]> {
    return this.decisions.filter(
      (event) =>
        event.workspaceId === workspaceId && event.proposalId === proposalId,
    );
  }
}

function request(): {
  objective: string;
  context: Array<{
    id: string;
    kind: 'task';
    title: string;
    status: 'active';
  }>;
} {
  return {
    objective: 'Ship a reviewable product increment',
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

function application(
  repository: InMemoryProposalAuditRepository,
  clock = () => new Date('2026-08-04T00:00:01.000Z'),
  decisionIdFactory = () => DECISION_ID,
): ProposalAuditApplication {
  return new ProposalAuditApplication(
    new ProposalService(
      new RuleBasedProposalModel(),
      () => new Date('2026-08-04T00:00:00.000Z'),
      () => PROPOSAL_ID,
    ),
    repository,
    'rule-based-v1',
    clock,
    decisionIdFactory,
  );
}

function decisionBody(contentDigest: string): {
  expectedContentDigest: string;
  idempotencyKey: string;
  decision: 'accepted';
  reason: string;
  decidedAt: string;
} {
  return {
    expectedContentDigest: contentDigest,
    idempotencyKey: IDEMPOTENCY_KEY,
    decision: 'accepted',
    reason: 'The proposal matches the reviewed plan.',
    decidedAt: '2026-08-04T00:00:02.000Z',
  };
}

describe('ProposalAuditApplication', () => {
  it('persists generated proposals before exposing tenant-scoped history', async () => {
    const repository = new InMemoryProposalAuditRepository();
    const service = application(repository);

    const proposal = await service.generateProposal(WORKSPACE_ID, request());

    expect(proposal.proposalId).toBe(PROPOSAL_ID);
    expect(repository.records).toHaveLength(1);
    expect(repository.records[0]).toMatchObject({
      proposal,
      modelId: 'rule-based-v1',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });
    await expect(service.listProposals(WORKSPACE_ID)).resolves.toEqual(
      repository.records,
    );
    await expect(service.listProposals(OTHER_WORKSPACE_ID)).resolves.toEqual(
      [],
    );
    await expect(
      service.findProposal(WORKSPACE_ID, PROPOSAL_ID),
    ).resolves.toEqual(repository.records[0]);
  });

  it('appends explicit decisions and returns deterministic tenant history', async () => {
    const repository = new InMemoryProposalAuditRepository();
    const service = application(repository);
    await service.generateProposal(WORKSPACE_ID, request());
    const record = repository.records[0];
    if (!record) {
      throw new Error('Expected generated proposal audit record');
    }

    const event = await service.appendDecision(
      WORKSPACE_ID,
      PROPOSAL_ID,
      ACTOR_ID,
      decisionBody(record.contentDigest),
    );

    expect(event).toEqual({
      id: DECISION_ID,
      workspaceId: WORKSPACE_ID,
      proposalId: PROPOSAL_ID,
      proposalContentDigest: record.contentDigest,
      actorId: ACTOR_ID,
      decision: 'accepted',
      reason: 'The proposal matches the reviewed plan.',
      idempotencyKey: IDEMPOTENCY_KEY,
      decidedAt: '2026-08-04T00:00:02.000Z',
      recordedAt: '2026-08-04T00:00:01.000Z',
    });
    await expect(
      service.listDecisions(WORKSPACE_ID, PROPOSAL_ID),
    ).resolves.toEqual([event]);
  });

  it('fails closed for tenant-scoped absence and stale proposal revisions', async () => {
    const repository = new InMemoryProposalAuditRepository();
    const service = application(repository);
    await service.generateProposal(WORKSPACE_ID, request());

    await expect(
      service.findProposal(OTHER_WORKSPACE_ID, PROPOSAL_ID),
    ).rejects.toBeInstanceOf(ProposalAuditNotFoundError);
    await expect(
      service.listDecisions(OTHER_WORKSPACE_ID, PROPOSAL_ID),
    ).rejects.toBeInstanceOf(ProposalAuditNotFoundError);
    await expect(
      service.appendDecision(
        OTHER_WORKSPACE_ID,
        PROPOSAL_ID,
        ACTOR_ID,
        decisionBody('0'.repeat(64)),
      ),
    ).rejects.toBeInstanceOf(ProposalAuditNotFoundError);
    await expect(
      service.appendDecision(
        WORKSPACE_ID,
        PROPOSAL_ID,
        ACTOR_ID,
        decisionBody('0'.repeat(64)),
      ),
    ).rejects.toBeInstanceOf(ProposalDigestMismatchError);
  });

  it('rejects invalid clocks, generated decision ids, and actors', async () => {
    const repository = new InMemoryProposalAuditRepository();
    await expect(
      application(repository, () => new Date(Number.NaN)).generateProposal(
        WORKSPACE_ID,
        request(),
      ),
    ).rejects.toBeInstanceOf(ProposalAuditValidationError);

    const service = application(repository, undefined, () => 'not-a-uuid');
    await service.generateProposal(WORKSPACE_ID, request());
    const record = repository.records[0];
    if (!record) {
      throw new Error('Expected generated proposal audit record');
    }
    await expect(
      service.appendDecision(
        WORKSPACE_ID,
        PROPOSAL_ID,
        ACTOR_ID,
        decisionBody(record.contentDigest),
      ),
    ).rejects.toBeInstanceOf(ProposalAuditValidationError);
    await expect(
      application(repository).appendDecision(
        WORKSPACE_ID,
        PROPOSAL_ID,
        'not-an-actor',
        decisionBody(record.contentDigest),
      ),
    ).rejects.toBeInstanceOf(ProposalAuditValidationError);
  });
});

describe('validateProposalDecisionRequest', () => {
  it('normalizes the exact closed decision schema with and without a reason', () => {
    const digest = 'A'.repeat(64);
    expect(
      validateProposalDecisionRequest({
        expectedContentDigest: digest,
        idempotencyKey: IDEMPOTENCY_KEY.toUpperCase(),
        decision: 'rejected',
        decidedAt: '2026-08-04T09:00:02+09:00',
      }),
    ).toEqual({
      expectedContentDigest: 'a'.repeat(64),
      idempotencyKey: IDEMPOTENCY_KEY,
      decision: 'rejected',
      decidedAt: '2026-08-04T00:00:02.000Z',
    });
    expect(
      validateProposalDecisionRequest({
        ...decisionBody('a'.repeat(64)),
        reason: '  Reviewed  ',
      }),
    ).toMatchObject({ reason: 'Reviewed' });
  });

  it.each([
    null,
    [],
    {},
    {
      ...decisionBody('a'.repeat(64)),
      workspaceId: WORKSPACE_ID,
    },
    {
      ...decisionBody('invalid'),
    },
    {
      ...decisionBody('a'.repeat(64)),
      idempotencyKey: 'invalid',
    },
    {
      ...decisionBody('a'.repeat(64)),
      decision: 'applied',
    },
    {
      ...decisionBody('a'.repeat(64)),
      decidedAt: 'tomorrow',
    },
    {
      ...decisionBody('a'.repeat(64)),
      reason: ' ',
    },
    {
      ...decisionBody('a'.repeat(64)),
      reason: 'x'.repeat(1_001),
    },
  ])('rejects malformed or ownership-injecting input %#', (value) => {
    expect(() => validateProposalDecisionRequest(value)).toThrow(
      ProposalAuditValidationError,
    );
  });
});
