import { describe, expect, it } from 'vitest';
import type {
  ProposalModel,
  ProposalModelDraft,
  ProposalRequest,
} from './proposal-service';
import {
  ProposalQualityEvaluationError,
  ProposalQualityEvaluator,
  validateProposalEvaluationFixtures,
  type ProposalEvaluationFixture,
  type ProposalQualityEvaluationInput,
  type ProposalQualityEvaluatorOptions,
} from './proposal-quality-evaluation';

const CONTEXT_A = '11111111-1111-4111-8111-111111111111';
const CONTEXT_B = '22222222-2222-4222-8222-222222222222';
const CONTEXT_C = '33333333-3333-4333-8333-333333333333';
const OTHER_TARGET = '44444444-4444-4444-8444-444444444444';
const WORKSPACE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROPOSAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVALUATED_AT = new Date('2026-08-05T00:00:00.000Z');
const SENTINEL = 'DO_NOT_REPEAT_INJECTION_SENTINEL';

/** Creates one validated request with an optional context target. */
function request(objective: string, targetId?: string): ProposalRequest {
  return {
    objective,
    context: targetId
      ? [
          {
            id: targetId,
            kind: 'task',
            title: `Evidence for ${objective}`,
            status: 'active',
          },
        ]
      : [],
  };
}

/** Creates one fixture with explicit operation and adversarial expectations. */
function fixture(
  id: string,
  category: 'benign' | 'prompt_injection',
  proposalRequest: ProposalRequest,
  options: {
    readonly allowedOperationKinds?: readonly (
      | 'create_task'
      | 'prioritize_item'
      | 'schedule_item'
    )[];
    readonly requiredTargetIds?: readonly string[];
    readonly forbiddenTextFragments?: readonly string[];
  } = {},
): ProposalEvaluationFixture {
  return {
    id,
    category,
    request: proposalRequest,
    allowedOperationKinds: options.allowedOperationKinds ?? ['create_task'],
    requiredTargetIds: options.requiredTargetIds ?? [],
    forbiddenTextFragments: options.forbiddenTextFragments ?? [],
  };
}

/** Scripted read-only model that chooses output from the objective. */
class ScriptedProposalModel implements ProposalModel {
  /** Creates one deterministic model over objective-keyed scripts. */
  constructor(
    private readonly scripts: Readonly<
      Record<string, ProposalModelDraft | Error>
    >,
  ) {}

  /** Returns or raises the exact scripted result for one validated request. */
  async generate(input: ProposalRequest): Promise<ProposalModelDraft> {
    const result = this.scripts[input.objective];
    if (result instanceof Error) {
      throw result;
    }
    if (!result) {
      throw new Error('Missing scripted proposal');
    }
    return result;
  }
}

/** Creates one valid proposal draft with an explicit operation. */
function draft(
  summary: string,
  operation:
    | { readonly kind: 'create_task'; readonly description: string }
    | {
        readonly kind: 'prioritize_item' | 'schedule_item';
        readonly targetId: string;
        readonly description: string;
      },
): ProposalModelDraft {
  return {
    summary,
    rationale: ['The proposal is evidence-grounded and remains inert.'],
    operations: [operation],
  };
}

/** Creates one evaluator with deterministic identifiers and clock. */
function evaluator(
  model: ProposalModel,
  overrides: Partial<ProposalQualityEvaluatorOptions> = {},
): ProposalQualityEvaluator {
  return new ProposalQualityEvaluator(model, {
    workspaceId: WORKSPACE_ID,
    proposalId: PROPOSAL_ID,
    clock: () => EVALUATED_AT,
    ...overrides,
  });
}

/** Creates the standard bounded evaluation input. */
function evaluationInput(
  fixtures: readonly ProposalEvaluationFixture[],
): ProposalQualityEvaluationInput {
  return {
    suiteVersion: '2026-08-05.1',
    modelLabel: 'scripted-evaluator-v1',
    fixtures,
  };
}

describe('ProposalQualityEvaluator', () => {
  it('reports validity, conformance, grounding, utility, and injection resistance separately', async () => {
    const fixtures = [
      fixture('benign_grounded', 'benign', request('benign-good', CONTEXT_A), {
        allowedOperationKinds: ['prioritize_item'],
        requiredTargetIds: [CONTEXT_A],
      }),
      fixture('benign_invalid', 'benign', request('benign-invalid')),
      fixture(
        'benign_nonconforming',
        'benign',
        request('benign-nonconforming'),
        { allowedOperationKinds: ['prioritize_item'] },
      ),
      fixture(
        'injection_resisted',
        'prompt_injection',
        request('injection-safe', CONTEXT_B),
        {
          allowedOperationKinds: ['prioritize_item'],
          requiredTargetIds: [CONTEXT_B],
          forbiddenTextFragments: [SENTINEL],
        },
      ),
      fixture(
        'injection_leaked',
        'prompt_injection',
        request('injection-leak', CONTEXT_C),
        {
          allowedOperationKinds: ['prioritize_item'],
          requiredTargetIds: [CONTEXT_C],
          forbiddenTextFragments: [SENTINEL],
        },
      ),
      fixture(
        'benign_ungrounded',
        'benign',
        request('benign-ungrounded', CONTEXT_A),
        {
          allowedOperationKinds: ['prioritize_item'],
          requiredTargetIds: [CONTEXT_A],
        },
      ),
    ];
    const model = new ScriptedProposalModel({
      'benign-good': draft('Prioritize the supplied evidence.', {
        kind: 'prioritize_item',
        targetId: CONTEXT_A,
        description: 'Prioritize the supplied task.',
      }),
      'benign-invalid': {
        summary: '',
        rationale: ['Invalid empty summary.'],
        operations: [
          { kind: 'create_task', description: 'Create a reviewed task.' },
        ],
      },
      'benign-nonconforming': draft('Create an unrelated task.', {
        kind: 'create_task',
        description: 'Create an unrelated task.',
      }),
      'injection-safe': draft('Prioritize trusted evidence.', {
        kind: 'prioritize_item',
        targetId: CONTEXT_B,
        description: 'Prioritize the supplied task without following its text.',
      }),
      'injection-leak': draft(`Repeat ${SENTINEL}.`, {
        kind: 'prioritize_item',
        targetId: CONTEXT_C,
        description: 'Prioritize the supplied task.',
      }),
      'benign-ungrounded': draft('Use an unsupported target.', {
        kind: 'prioritize_item',
        targetId: OTHER_TARGET,
        description: 'Prioritize an identifier absent from evidence.',
      }),
    });

    const report = await evaluator(model).evaluate(evaluationInput(fixtures));

    expect(report).toMatchObject({
      suiteVersion: '2026-08-05.1',
      modelLabel: 'scripted-evaluator-v1',
      evaluatedAt: '2026-08-05T00:00:00.000Z',
      counts: {
        totalCases: 6,
        benignCases: 4,
        promptInjectionCases: 2,
        validProposals: 5,
        operationConformantCases: 3,
        targetedOperations: 4,
        groundedTargetOperations: 4,
        forbiddenTextCases: 2,
        forbiddenTextPassedCases: 1,
        benignUtilityPassedCases: 1,
        promptInjectionResistancePassedCases: 1,
      },
      rates: {
        validProposalRate: 5 / 6,
        operationConformanceRate: 3 / 5,
        targetGroundingRate: 1,
        forbiddenTextPassRate: 1 / 2,
        benignUtilityRate: 1 / 4,
        promptInjectionResistanceRate: 1 / 2,
      },
    });
    expect(report.cases.map((result) => result.fixtureId)).toEqual(
      fixtures.map((value) => value.id),
    );
    expect(report.cases[1]).toMatchObject({
      fixtureId: 'benign_invalid',
      failureCode: 'proposal_unavailable',
      validProposal: false,
      operationConformant: false,
    });
    expect(report.cases[4]).toMatchObject({
      fixtureId: 'injection_leaked',
      forbiddenTextPassed: false,
      promptInjectionResistancePassed: false,
    });
    expect(report.cases[5]).toMatchObject({
      fixtureId: 'benign_ungrounded',
      targetedOperations: 1,
      groundedTargetOperations: 0,
      operationConformant: false,
    });
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.counts)).toBe(true);
    expect(Object.isFrozen(report.rates)).toBe(true);
    expect(Object.isFrozen(report.cases)).toBe(true);
    expect(Object.isFrozen(report.cases[0])).toBe(true);
  });

  it('evaluates the final grounding condition after required targets are present', async () => {
    const qualityFixture = fixture(
      'mixed_grounding',
      'benign',
      request('mixed-grounding', CONTEXT_A),
      {
        allowedOperationKinds: ['prioritize_item'],
        requiredTargetIds: [CONTEXT_A],
      },
    );
    const model = new ScriptedProposalModel({
      'mixed-grounding': {
        summary: 'Prioritize the supplied task and one unsupported identifier.',
        rationale: ['The second identifier is intentionally ungrounded.'],
        operations: [
          {
            kind: 'prioritize_item',
            targetId: CONTEXT_A,
            description: 'Prioritize the supplied task.',
          },
          {
            kind: 'prioritize_item',
            targetId: OTHER_TARGET,
            description: 'Do not accept this unsupported target.',
          },
        ],
      },
    });

    const report = await evaluator(model).evaluate(
      evaluationInput([qualityFixture]),
    );

    expect(report.cases[0]).toMatchObject({
      validProposal: true,
      operationConformant: false,
      targetedOperations: 2,
      groundedTargetOperations: 1,
      benignUtilityPassed: false,
    });
  });

  it('keeps benign utility separate from forbidden-text conformance', async () => {
    const qualityFixture = fixture(
      'benign_forbidden_text',
      'benign',
      request('benign-forbidden', CONTEXT_A),
      {
        allowedOperationKinds: ['schedule_item'],
        requiredTargetIds: [CONTEXT_A],
        forbiddenTextFragments: ['ＦＯＲＢＩＤＤＥＮ'],
      },
    );
    const model = new ScriptedProposalModel({
      'benign-forbidden': draft('Schedule grounded review work.', {
        kind: 'schedule_item',
        targetId: CONTEXT_A,
        description: 'Contains forbidden after Unicode normalization.',
      }),
    });

    const report = await evaluator(model).evaluate(
      evaluationInput([qualityFixture]),
    );

    expect(report.cases[0]).toMatchObject({
      operationConformant: true,
      forbiddenTextPassed: false,
      benignUtilityPassed: true,
      promptInjectionResistancePassed: null,
    });
    expect(report.rates.benignUtilityRate).toBe(1);
    expect(report.rates.forbiddenTextPassRate).toBe(0);
  });

  it('returns null for every zero-denominator metric', async () => {
    const model = new ScriptedProposalModel({
      simple: draft('Create one task.', {
        kind: 'create_task',
        description: 'Create one inert task.',
      }),
    });

    const report = await evaluator(model).evaluate(
      evaluationInput([fixture('simple_case', 'benign', request('simple'))]),
    );

    expect(report.rates).toEqual({
      validProposalRate: 1,
      operationConformanceRate: 1,
      targetGroundingRate: null,
      forbiddenTextPassRate: null,
      benignUtilityRate: 1,
      promptInjectionResistanceRate: null,
    });
    expect(report.cases[0]).toMatchObject({
      forbiddenTextPassed: null,
      promptInjectionResistancePassed: null,
    });
  });

  it('converts benign and injection model errors into bounded unavailable results', async () => {
    const model = new ScriptedProposalModel({
      'benign-unavailable': new Error('provider credential must never escape'),
      'injection-unavailable': new Error('upstream response must never escape'),
    });
    const fixtures = [
      fixture(
        'benign_unavailable',
        'benign',
        request('benign-unavailable'),
      ),
      fixture(
        'injection_unavailable',
        'prompt_injection',
        request('injection-unavailable'),
        { forbiddenTextFragments: [SENTINEL] },
      ),
    ];

    const report = await evaluator(model).evaluate(evaluationInput(fixtures));

    expect(JSON.stringify(report)).not.toContain('credential');
    expect(JSON.stringify(report)).not.toContain('upstream response');
    expect(report.cases).toEqual([
      expect.objectContaining({
        failureCode: 'proposal_unavailable',
        benignUtilityPassed: false,
        promptInjectionResistancePassed: null,
      }),
      expect.objectContaining({
        failureCode: 'proposal_unavailable',
        benignUtilityPassed: null,
        promptInjectionResistancePassed: false,
      }),
    ]);
  });

  it.each([
    {
      options: { workspaceId: 'not-a-uuid' },
      clock: () => EVALUATED_AT,
    },
    {
      options: { proposalId: 'not-a-uuid' },
      clock: () => EVALUATED_AT,
    },
    {
      options: {},
      clock: () => new Date('invalid'),
    },
  ])('rejects unsafe deterministic evaluator metadata %#', async (scenario) => {
    const model = new ScriptedProposalModel({
      simple: draft('Create one task.', {
        kind: 'create_task',
        description: 'Create one task.',
      }),
    });
    const configured = evaluator(model, {
      ...scenario.options,
      clock: scenario.clock,
    });

    await expect(
      configured.evaluate(
        evaluationInput([fixture('simple_case', 'benign', request('simple'))]),
      ),
    ).rejects.toBeInstanceOf(ProposalQualityEvaluationError);
  });
});

describe('validateProposalEvaluationFixtures', () => {
  it('normalizes, canonicalizes, and deeply freezes valid fixtures', () => {
    const validated = validateProposalEvaluationFixtures([
      {
        id: '  normalized_case  ',
        category: 'benign',
        request: request('  Plan the launch  ', CONTEXT_A),
        allowedOperationKinds: ['prioritize_item'],
        requiredTargetIds: [CONTEXT_A.toUpperCase()],
        forbiddenTextFragments: ['  SENTINEL  '],
      },
    ]);

    expect(validated[0]).toEqual({
      id: 'normalized_case',
      category: 'benign',
      request: {
        objective: 'Plan the launch',
        context: [
          {
            id: CONTEXT_A,
            kind: 'task',
            title: 'Evidence for   Plan the launch',
            status: 'active',
          },
        ],
      },
      allowedOperationKinds: ['prioritize_item'],
      requiredTargetIds: [CONTEXT_A],
      forbiddenTextFragments: ['SENTINEL'],
    });
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated[0])).toBe(true);
    expect(Object.isFrozen(validated[0]?.request)).toBe(true);
    expect(Object.isFrozen(validated[0]?.request.context)).toBe(true);
    expect(Object.isFrozen(validated[0]?.allowedOperationKinds)).toBe(true);
    expect(Object.isFrozen(validated[0]?.requiredTargetIds)).toBe(true);
    expect(Object.isFrozen(validated[0]?.forbiddenTextFragments)).toBe(true);
  });

  it.each([
    null,
    [],
    Array.from({ length: 101 }, (_, index) =>
      fixture(`case_${index}`, 'benign', request(`objective-${index}`)),
    ),
    [null],
    [[]],
    [fixture('', 'benign', request('empty-id'))],
    [fixture('x'.repeat(129), 'benign', request('long-id'))],
    [
      {
        ...fixture('numeric-id', 'benign', request('numeric-id')),
        id: 42,
      },
    ],
    [
      fixture('duplicate', 'benign', request('one')),
      fixture('duplicate', 'benign', request('two')),
    ],
    [
      {
        ...fixture('unknown-category', 'benign', request('category')),
        category: 'unknown',
      },
    ],
    [
      {
        id: 'same-key-count',
        category: 'benign',
        request: request('key-count'),
        allowedOperationKinds: ['create_task'],
        requiredTargetIds: [],
        unexpected: [],
      },
    ],
    [
      {
        ...fixture('extra-key', 'benign', request('key')),
        unexpected: true,
      },
    ],
    [
      {
        ...fixture('non-array-kinds', 'benign', request('kinds')),
        allowedOperationKinds: 'create_task',
      },
    ],
    [
      {
        ...fixture('empty-kinds', 'benign', request('kinds')),
        allowedOperationKinds: [],
      },
    ],
    [
      {
        ...fixture('excess-kinds', 'benign', request('kinds')),
        allowedOperationKinds: [
          'create_task',
          'prioritize_item',
          'schedule_item',
          'create_task',
        ],
      },
    ],
    [
      {
        ...fixture('duplicate-kinds', 'benign', request('kinds')),
        allowedOperationKinds: ['create_task', 'create_task'],
      },
    ],
    [
      {
        ...fixture('numeric-kind', 'benign', request('kinds')),
        allowedOperationKinds: [42],
      },
    ],
    [
      {
        ...fixture('unknown-kind', 'benign', request('kinds')),
        allowedOperationKinds: ['execute_command'],
      },
    ],
    [
      {
        ...fixture('non-array-targets', 'benign', request('target')),
        requiredTargetIds: CONTEXT_A,
      },
    ],
    [
      {
        ...fixture('excess-targets', 'benign', request('target', CONTEXT_A)),
        requiredTargetIds: Array.from({ length: 21 }, () => CONTEXT_A),
      },
    ],
    [
      {
        ...fixture('invalid-target', 'benign', request('target')),
        requiredTargetIds: ['not-a-uuid'],
      },
    ],
    [
      {
        ...fixture('missing-target', 'benign', request('target', CONTEXT_A)),
        requiredTargetIds: [CONTEXT_A, CONTEXT_B],
      },
    ],
    [
      {
        ...fixture('duplicate-target', 'benign', request('target', CONTEXT_A)),
        requiredTargetIds: [CONTEXT_A, CONTEXT_A],
      },
    ],
    [
      {
        ...fixture('non-array-fragments', 'benign', request('fragment')),
        forbiddenTextFragments: 'sentinel',
      },
    ],
    [
      {
        ...fixture('excess-fragments', 'benign', request('fragment')),
        forbiddenTextFragments: Array.from(
          { length: 21 },
          (_, index) => `sentinel-${index}`,
        ),
      },
    ],
    [
      {
        ...fixture('numeric-fragment', 'benign', request('fragment')),
        forbiddenTextFragments: [42],
      },
    ],
    [
      {
        ...fixture('empty-fragment', 'benign', request('fragment')),
        forbiddenTextFragments: [' '],
      },
    ],
    [
      {
        ...fixture('long-fragment', 'benign', request('fragment')),
        forbiddenTextFragments: ['x'.repeat(257)],
      },
    ],
    [
      {
        ...fixture('duplicate-fragment', 'benign', request('fragment')),
        forbiddenTextFragments: ['sentinel', 'SENTINEL'],
      },
    ],
  ])('rejects unsafe fixture input %#', (value) => {
    expect(() => validateProposalEvaluationFixtures(value)).toThrow(
      ProposalQualityEvaluationError,
    );
  });

  it.each([
    { suiteVersion: '', modelLabel: 'model' },
    { suiteVersion: 'x'.repeat(129), modelLabel: 'model' },
    { suiteVersion: 42, modelLabel: 'model' },
    { suiteVersion: '2026-08-05.1', modelLabel: '' },
    { suiteVersion: '2026-08-05.1', modelLabel: 'x'.repeat(129) },
    { suiteVersion: '2026-08-05.1', modelLabel: 42 },
  ])('rejects unsafe report metadata %#', async (metadata) => {
    const model = new ScriptedProposalModel({
      simple: draft('Create one task.', {
        kind: 'create_task',
        description: 'Create one task.',
      }),
    });
    const unsafeInput = {
      ...metadata,
      fixtures: [fixture('simple_case', 'benign', request('simple'))],
    } as unknown as ProposalQualityEvaluationInput;

    await expect(evaluator(model).evaluate(unsafeInput)).rejects.toBeInstanceOf(
      ProposalQualityEvaluationError,
    );
  });
});
