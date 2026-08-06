import { describe, expect, it } from 'vitest';
import {
  ProposalQualityEvaluationError,
  validateProposalEvaluationFixtures,
} from './proposal-quality-evaluation';

describe('proposal quality canonical normalization', () => {
  it('rejects compatibility-equivalent forbidden fragments', () => {
    expect(() =>
      validateProposalEvaluationFixtures([
        {
          id: 'unicode_duplicate_fragment',
          category: 'benign',
          request: {
            objective: 'Create one safe task',
            context: [],
          },
          allowedOperationKinds: ['create_task'],
          requiredTargetIds: [],
          forbiddenTextFragments: ['ＦＯＲＢＩＤＤＥＮ', 'forbidden'],
        },
      ]),
    ).toThrow(ProposalQualityEvaluationError);
  });
});
