import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ProposalQualityEvaluationError,
  validateProposalEvaluationFixtures,
} from './proposal-quality-evaluation';

/** Reads one repository text artifact relative to this test module. */
function readRepositoryText(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('proposal quality review regressions', () => {
  it('normalizes invalid nested proposal requests to the evaluator error contract', () => {
    const invalidFixture = {
      id: 'invalid-request',
      category: 'benign',
      request: { objective: '', context: [] },
      allowedOperationKinds: ['create_task'],
      requiredTargetIds: [],
      forbiddenTextFragments: [],
    };

    expect(() => validateProposalEvaluationFixtures([invalidFixture])).toThrowError(
      ProposalQualityEvaluationError,
    );
  });

  it('derives the bounded allowed-kind cardinality from the authoritative set', () => {
    const source = readRepositoryText('./proposal-quality-evaluation.ts');

    expect(source).toContain(
      'value.length > EVALUATION_OPERATION_KINDS.size',
    );
    expect(source).not.toContain('value.length > 3');
  });

  it('converts only provider-boundary failures into unavailable cases', () => {
    const source = readRepositoryText('./proposal-quality-evaluation.ts');
    const loop = source.slice(
      source.indexOf('for (const fixture of fixtures)'),
      source.indexOf('const frozenCases = Object.freeze(cases)'),
    );
    const generation = loop.indexOf('await service.generateProposal');
    const unavailable = loop.indexOf('cases.push(unavailableCase(fixture))');
    const semanticScoring = loop.indexOf(
      'cases.push(successfulCase(fixture, proposal))',
    );

    expect(generation).toBeGreaterThanOrEqual(0);
    expect(unavailable).toBeGreaterThan(generation);
    expect(semanticScoring).toBeGreaterThan(unavailable);
    expect(loop.slice(unavailable, semanticScoring)).toContain('continue;');
  });

  it('keeps operation-count and CyberSecEval evidence consistent across docs', () => {
    const operations = readRepositoryText(
      '../../../docs/operations/ai-proposal-quality-evaluation.md',
    );
    const design = readRepositoryText(
      '../../../docs/superpowers/specs/2026-08-05-ai-proposal-quality-evaluation-design.md',
    );
    const plan = readRepositoryText(
      '../../../docs/superpowers/plans/2026-08-05-ai-proposal-quality-evaluation.md',
    );

    expect(operations).toContain(
      'validateOperations` boundary, which guarantees 1–20 operations',
    );
    expect(design).toContain(
      'production validator already guarantees 1–20 operations',
    );
    expect(plan).toContain(
      '`ProposalService.validateOperations` enforces 1–20 operations before semantic scoring',
    );
    expect(design).toContain(
      'Song, D., Wan, S., Ahmad, F., Aschermann, C.',
    );
    expect(design).not.toContain('Song, D., Ahmad, S., Aschermann, C.');
  });
});
