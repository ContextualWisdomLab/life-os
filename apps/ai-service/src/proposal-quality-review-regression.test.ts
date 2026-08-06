import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ProposalQualityEvaluationError as EvaluationError,
  validateProposalEvaluationFixtures as validate,
} from './proposal-quality-evaluation';

/** Reads one repository text artifact relative to this test module. */
function readText(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), 'utf8');
}

describe('proposal quality review regressions', () => {
  it('normalizes invalid nested proposal requests', () => {
    const fixture = {
      id: 'invalid-request',
      category: 'benign',
      request: { objective: '', context: [] },
      allowedOperationKinds: ['create_task'],
      requiredTargetIds: [],
      forbiddenTextFragments: [],
    };

    expect(() => validate([fixture])).toThrowError(EvaluationError);
  });

  it('does not mask unexpected request inspection failures', () => {
    const unexpected = new TypeError('unexpected request inspection failure');
    const request = new Proxy(
      {},
      {
        ownKeys() {
          throw unexpected;
        },
      },
    );
    const fixture = {
      id: 'hostile-request',
      category: 'benign',
      request,
      allowedOperationKinds: ['create_task'],
      requiredTargetIds: [],
      forbiddenTextFragments: [],
    };

    expect(() => validate([fixture])).toThrow(unexpected);
  });

  it('derives allowed-kind cardinality from the authoritative set', () => {
    const source = readText('./proposal-quality-evaluation.ts');
    const derivedLimit = 'value.length > EVALUATION_OPERATION_KINDS.size';

    expect(source).toContain(derivedLimit);
    expect(source).not.toContain('value.length > 3');
  });

  it('isolates provider failures from semantic scoring', () => {
    const source = readText('./proposal-quality-evaluation.ts');
    const loopStart = source.indexOf('for (const fixture of fixtures)');
    const loopEnd = source.indexOf('const frozenCases = Object.freeze(cases)');
    const loop = source.slice(loopStart, loopEnd);
    const generation = loop.indexOf('await service.generateProposal');
    const unavailable = loop.indexOf('cases.push(unavailableCase(fixture))');
    const scoring = loop.indexOf(
      'cases.push(successfulCase(fixture, proposal))',
    );

    expect(generation).toBeGreaterThanOrEqual(0);
    expect(unavailable).toBeGreaterThan(generation);
    expect(scoring).toBeGreaterThan(unavailable);
    expect(loop.slice(unavailable, scoring)).toContain('continue;');
  });

  it('keeps operation-count and research evidence consistent', () => {
    const operations = readText(
      '../../../docs/operations/ai-proposal-quality-evaluation.md',
    );
    const design = readText(
      '../../../docs/superpowers/specs/2026-08-05-ai-proposal-quality-evaluation-design.md',
    );
    const plan = readText(
      '../../../docs/superpowers/plans/2026-08-05-ai-proposal-quality-evaluation.md',
    );
    const operationContract =
      'validateOperations` boundary, which guarantees 1–20 operations';
    const designContract =
      'production validator already guarantees 1–20 operations';
    const planContract =
      '`ProposalService.validateOperations` enforces 1–20 operations before semantic scoring';
    const correctedAuthors = 'Song, D., Wan, S., Ahmad, F., Aschermann, C.';

    expect(operations).toContain(operationContract);
    expect(design).toContain(designContract);
    expect(plan).toContain(planContract);
    expect(design).toContain(correctedAuthors);
    expect(design).not.toContain('Song, D., Ahmad, S., Aschermann, C.');
  });
});
