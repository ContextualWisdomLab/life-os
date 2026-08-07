import { describe, expect, it } from 'vitest';
import { CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA } from './contextual-orchestrator-proposal-model';

interface MutableProposalSchema {
  properties: {
    operations: {
      items: {
        oneOf: unknown[];
      };
    };
  };
}

describe('contextual-orchestrator proposal schema immutability', () => {
  it('deep-freezes nested structured-output contract values', () => {
    const schema =
      CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA as unknown as MutableProposalSchema;
    const operations = schema.properties.operations;
    const items = operations.items;

    expect(Object.isFrozen(CONTEXTUAL_ORCHESTRATOR_PROPOSAL_SCHEMA)).toBe(true);
    expect(Object.isFrozen(schema.properties)).toBe(true);
    expect(Object.isFrozen(operations)).toBe(true);
    expect(Object.isFrozen(items)).toBe(true);
    expect(Object.isFrozen(items.oneOf)).toBe(true);
    expect(() => items.oneOf.push({ type: 'object' })).toThrow(TypeError);
  });
});
