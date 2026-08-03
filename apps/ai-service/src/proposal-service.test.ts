import { describe, expect, it } from 'vitest';
import {
  type ProposalModel,
  ProposalService,
  ProposalValidationError,
  RuleBasedProposalModel,
  validateProposalRequest,
} from './proposal-service';

const WORKSPACE_ID = 'd3bd2d90-0809-4f55-a4f0-cc3cb8a0fa3c';
const TASK_ID = 'f6bd6684-8fa2-45ff-b0ef-3f5ef847ed4b';
const PROPOSAL_ID = '82033ed9-fc13-49b8-8986-c3e5211cb355';

const request = {
  objective: 'Prepare the most important work for today',
  context: [
    {
      id: TASK_ID,
      kind: 'task',
      title: 'Draft the launch checklist',
      status: 'active',
    },
  ],
} as const;

describe('ProposalService', () => {
  it('returns an immutable proposal that requires explicit confirmation', async () => {
    const service = new ProposalService(
      new RuleBasedProposalModel(),
      () => new Date('2026-08-04T00:00:00.000Z'),
      () => PROPOSAL_ID,
    );

    const proposal = await service.generateProposal(WORKSPACE_ID, request);

    expect(proposal).toEqual({
      proposalId: PROPOSAL_ID,
      workspaceId: WORKSPACE_ID,
      summary: 'Focus the next action on Draft the launch checklist.',
      rationale: [
        'The item is active and directly supports the stated objective.',
        'No user-owned record will change until the proposal is explicitly confirmed.',
      ],
      operations: [
        {
          kind: 'prioritize_item',
          targetId: TASK_ID,
          description:
            'Prioritize Draft the launch checklist for explicit user review.',
        },
      ],
      requiresConfirmation: true,
      createdAt: '2026-08-04T00:00:00.000Z',
    });
    expect(Object.isFrozen(proposal)).toBe(true);
    expect(Object.isFrozen(proposal.operations)).toBe(true);
    expect(Object.isFrozen(proposal.operations[0])).toBe(true);
  });

  it('keeps generated text valid at every accepted input boundary', async () => {
    const service = new ProposalService(
      new RuleBasedProposalModel(),
      () => new Date('2026-08-04T00:00:00.000Z'),
      () => PROPOSAL_ID,
    );
    const longTitle = 'T'.repeat(1_000);
    const longObjective = 'O'.repeat(2_000);

    const targeted = await service.generateProposal(WORKSPACE_ID, {
      objective: longObjective,
      context: [
        {
          id: TASK_ID,
          kind: 'task',
          title: longTitle,
          status: 'active',
        },
      ],
    });
    expect(targeted.summary.length).toBeLessThanOrEqual(1_000);
    expect(targeted.operations[0]?.description.length).toBeLessThanOrEqual(
      1_000,
    );
    expect(targeted.summary).toContain('…');
    expect(targeted.operations[0]?.description).toContain('…');

    const created = await service.generateProposal(WORKSPACE_ID, {
      objective: longObjective,
      context: [],
    });
    expect(created.operations[0]?.description.length).toBe(1_000);
    expect(created.operations[0]?.description.endsWith('…')).toBe(true);
  });

  it('rejects extra request properties and malformed model output', async () => {
    expect(() =>
      validateProposalRequest({
        ...request,
        workspaceId: WORKSPACE_ID,
      }),
    ).toThrow(ProposalValidationError);

    const invalidModel: ProposalModel = {
      async generate() {
        return {
          summary: 'Unsafe output',
          rationale: [],
          operations: [
            {
              kind: 'delete_everything',
              description: 'Mutate user state',
            },
          ],
        };
      },
    };
    const service = new ProposalService(invalidModel);
    await expect(
      service.generateProposal(WORKSPACE_ID, request),
    ).rejects.toBeInstanceOf(ProposalValidationError);
  });

  it('rejects non-opaque workspace and context identifiers', async () => {
    const service = new ProposalService(new RuleBasedProposalModel());
    await expect(service.generateProposal('42', request)).rejects.toBeInstanceOf(
      ProposalValidationError,
    );
    expect(() =>
      validateProposalRequest({
        objective: request.objective,
        context: [{ ...request.context[0], id: '1' }],
      }),
    ).toThrow(ProposalValidationError);
  });
});
