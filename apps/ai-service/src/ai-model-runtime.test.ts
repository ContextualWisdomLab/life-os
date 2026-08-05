import { describe, expect, it } from 'vitest';
import { ContextualOrchestratorProposalModel } from './contextual-orchestrator-proposal-model';
import { createProposalModelRuntime } from './ai-model-runtime';
import { RuleBasedProposalModel } from './proposal-service';

const ORCHESTRATOR_TOKEN = Buffer.alloc(32, 0x52).toString('base64url');

/** Builds one valid external model environment without a literal credential. */
function externalEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    AI_PROPOSAL_MODEL: 'contextual-orchestrator',
    CONTEXTUAL_ORCHESTRATOR_URL: 'https://orchestrator.example.test',
    CONTEXTUAL_ORCHESTRATOR_TOKEN: ORCHESTRATOR_TOKEN,
  };
}

describe('AI proposal model runtime selection', () => {
  it('defaults to the independent rule-based model', () => {
    const selected = createProposalModelRuntime({});

    expect(selected.model).toBeInstanceOf(RuleBasedProposalModel);
    expect(selected.modelId).toBe('rule-based-v1');
    expect(Object.isFrozen(selected)).toBe(true);
    expect(
      createProposalModelRuntime({ AI_PROPOSAL_MODEL: '' }).modelId,
    ).toBe('rule-based-v1');
    expect(
      createProposalModelRuntime({ AI_PROPOSAL_MODEL: 'rule-based' }).modelId,
    ).toBe('rule-based-v1');
  });

  it('selects contextual-orchestrator with an injected Fetch boundary', async () => {
    const selected = createProposalModelRuntime(
      externalEnvironment(),
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: 'Create one next task.',
                    rationale: ['No active item was supplied.'],
                    operations: [
                      {
                        kind: 'create_task',
                        description: 'Create the next task.',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        ),
    );

    expect(selected.model).toBeInstanceOf(
      ContextualOrchestratorProposalModel,
    );
    expect(selected.modelId).toBe('contextual-orchestrator-v1');
    await expect(
      selected.model.generate({ objective: 'Plan today', context: [] }),
    ).resolves.toMatchObject({ summary: 'Create one next task.' });
  });

  it('rejects unsupported explicit model modes', () => {
    expect(() =>
      createProposalModelRuntime({ AI_PROPOSAL_MODEL: 'unsupported' }),
    ).toThrow('AI proposal model is invalid');
  });
});
