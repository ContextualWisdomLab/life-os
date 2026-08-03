import type { AddressInfo } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AiAppModule } from './main';
import {
  type ProposalModel,
  ProposalService,
  RuleBasedProposalModel,
} from './proposal-service';

const WORKSPACE_ID = '43eab0ee-0f7b-4c7f-9331-b133f2647675';
const TASK_ID = 'e29c36af-999a-407f-9ca9-cfe194ab51f4';
const PROPOSAL_ID = 'aedcb1d1-cc60-42c6-9357-ec90821fce1b';
const SYNTHETIC_CSRF_TOKEN = 'synthetic-test-csrf-token';

function userOwnedState(): {
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

describe('AI proposal no-silent-mutation contract', () => {
  it('generates an inert proposal while leaving user-owned state byte-identical', async () => {
    const state = userOwnedState();
    const before = JSON.stringify(state);
    const service = new ProposalService(
      new RuleBasedProposalModel(),
      () => new Date('2026-08-04T00:00:00.000Z'),
      () => PROPOSAL_ID,
    );

    const proposal = await service.generateProposal(WORKSPACE_ID, state);

    expect(JSON.stringify(state)).toBe(before);
    expect(proposal.requiresConfirmation).toBe(true);
    expect(proposal.operations).toEqual([
      {
        kind: 'prioritize_item',
        targetId: TASK_ID,
        description:
          'Prioritize Verify the release candidate for explicit user review.',
      },
    ]);
    expect('execute' in proposal).toBe(false);
    expect('apply' in proposal).toBe(false);
  });

  it('freezes model evidence so a mutating adapter fails closed', async () => {
    const state = userOwnedState();
    const before = JSON.stringify(state);
    const mutatingModel: ProposalModel = {
      async generate(input) {
        const firstItem = input.context[0];
        if (firstItem) {
          (firstItem as { title: string }).title = 'Silently changed';
        }
        return {
          summary: 'This output must never be accepted',
          rationale: ['Mutation was attempted'],
          operations: [
            {
              kind: 'create_task',
              description: 'Unsafe task',
            },
          ],
        };
      },
    };
    const service = new ProposalService(mutatingModel);

    await expect(service.generateProposal(WORKSPACE_ID, state)).rejects.toThrow(
      TypeError,
    );
    expect(JSON.stringify(state)).toBe(before);
  });

  it('exercises the production HTTP module without exposing a mutation route', async () => {
    const state = userOwnedState();
    const before = JSON.stringify(state);
    const app = await NestFactory.create(AiAppModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    try {
      const address = app.getHttpServer().address() as AddressInfo;
      const response = await fetch(
        `http://127.0.0.1:${address.port}/v1/proposals`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': SYNTHETIC_CSRF_TOKEN,
            'x-workspace-id': WORKSPACE_ID,
          },
          body: JSON.stringify(state),
        },
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        workspaceId: WORKSPACE_ID,
        requiresConfirmation: true,
        operations: [
          {
            kind: 'prioritize_item',
            targetId: TASK_ID,
          },
        ],
      });
      expect(JSON.stringify(state)).toBe(before);

      const unsupportedMutation = await fetch(
        `http://127.0.0.1:${address.port}/v1/proposals/apply`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': SYNTHETIC_CSRF_TOKEN,
            'x-workspace-id': WORKSPACE_ID,
          },
          body: JSON.stringify({ proposalId: PROPOSAL_ID }),
        },
      );
      expect(unsupportedMutation.status).toBe(404);
    } finally {
      await app.close();
    }
  });
});
