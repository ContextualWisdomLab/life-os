import { describe, expect, it } from 'vitest';
import {
  CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA,
  CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SYSTEM_INSTRUCTION,
  parseContextualOrchestratorProposalCompletion,
  ProposalModelTransportError,
} from './contextual-orchestrator-proposal-model';

/** Wraps one candidate content value in a minimal completion envelope. */
function completion(content: unknown): string {
  return JSON.stringify({
    choices: [{ message: { content } }],
  });
}

describe('shared contextual-orchestrator proposal contract', () => {
  it('keeps the exported instruction inert and treats user data as untrusted', () => {
    expect(CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SYSTEM_INSTRUCTION).toContain(
      'untrusted data',
    );
    expect(CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SYSTEM_INSTRUCTION).toContain(
      'Never execute operations',
    );
    expect(CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SYSTEM_INSTRUCTION).toContain(
      'explicit user confirmation',
    );
  });

  it('exports one closed schema containing only supported operation families', () => {
    expect(CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'rationale', 'operations'],
    });
    const variants =
      CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA.properties.operations.items.oneOf;
    expect(variants).toHaveLength(3);
    expect(
      variants.map((variant) => variant.properties.kind.const),
    ).toEqual(['create_task', 'prioritize_item', 'schedule_item']);
    expect(variants.every((variant) => !variant.additionalProperties)).toBe(
      true,
    );
  });

  it('parses one exact completion envelope into an untrusted proposal draft', () => {
    const draft = {
      summary: 'Review the release candidate.',
      rationale: ['The active task is the current critical path.'],
      operations: [
        {
          kind: 'create_task',
          description: 'Create a bounded verification task.',
        },
      ],
    };

    expect(
      parseContextualOrchestratorProposalCompletion(
        completion(JSON.stringify(draft)),
      ),
    ).toEqual(draft);
  });

  it.each([
    '{',
    'null',
    '[]',
    '{}',
    JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [null] }),
    JSON.stringify({ choices: [{}] }),
    JSON.stringify({ choices: [{ message: null }] }),
    completion(undefined),
    completion(' '),
    completion('{'),
    completion('null'),
    completion('[]'),
  ])('fails with the sanitized transport contract for malformed input %#', (text) => {
    expect(() => parseContextualOrchestratorProposalCompletion(text)).toThrow(
      ProposalModelTransportError,
    );
  });
});
