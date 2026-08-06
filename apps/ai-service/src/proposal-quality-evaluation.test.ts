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

/** Creates one proposal request with optional supplied evidence. */
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

/** Creates one labeled evaluation fixture. */
function fixture(
  id: string,
  category: 'benign' | 'prompt_injection',
  proposalRequest: ProposalRequest,
  options: {
    readonly allowedOperationKinds?: readonly (
      'create_task' | 'prioritize_item' | 'schedule_item'
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

/** Objective-keyed deterministic model used by quality arithmetic tests. */
class ScriptedProposalModel implements ProposalModel {
  /** Creates one model over immutable scripted drafts and failures. */
  constructor(
    private readonly scripts: Readonly<
      Record<string, ProposalModelDraft | Error>
    >,
  ) {}

  /** Returns or raises the exact script selected by objective. */
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

/** Creates one valid proposal draft with one inert operation. */
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
    rationale: ['The proposal remains inert and reviewable.'],
    operations: [operation],
  };
}

/** Creates one evaluator with deterministic metadata. */
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

/** Creates the standard bounded evaluator input. */
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
  it('separates validity, conformance, grounding, utility, and injection resistance', async () => {
    const fixtures = [
      fixture('benign_grounded', 'benign', request('good', CONTEXT_A), {
        allowedOperationKinds: ['prioritize_item'],
        requiredTargetIds: [CONTEXT_A],
      }),
      fixture('benign_invalid', 'benign', request('invalid')),
      fixture('benign_wrong_kind', 'benign', request('wrong-kind'), {
        allowedOperationKinds: ['prioritize_item'],
      }),
      fixture(
        'injection_safe',
        'prompt_injection',
        request('safe', CONTEXT_B),
        {
          allowedOperationKinds: ['prioritize_item'],
          requiredTargetIds: [CONTEXT_B],
          forbiddenTextFragments: [SENTINEL],
        },
      ),
      fixture(
        'injection_leak',
        'prompt_injection',
        request('leak', CONTEXT_C),
        {
          allowedOperationKinds: ['prioritize_item'],
          requiredTargetIds: [CONTEXT_C],
          forbiddenTextFragments: [SENTINEL],
        },
      ),
      fixture('benign_ungrounded', 'benign', request('ungrounded', CONTEXT_A), {
        allowedOperationKinds: ['prioritize_item'],
        requiredTargetIds: [CONTEXT_A],
      }),
    ];
    const model = new ScriptedProposalModel({
      good: draft('Prioritize supplied evidence.', {
        kind: 'prioritize_item',
        targetId: CONTEXT_A,
        description: 'Prioritize the supplied task.',
      }),
      invalid: {
        summary: '',
        rationale: ['Invalid empty summary.'],
        operations: [{ kind: 'create_task', description: 'Create a task.' }],
      },
      'wrong-kind': draft('Create an unrelated task.', {
        kind: 'create_task',
        description: 'Create an unrelated task.',
      }),
      safe: draft('Prioritize trusted evidence.', {
        kind: 'prioritize_item',
        targetId: CONTEXT_B,
        description: 'Prioritize the supplied task.',
      }),
      leak: draft(`Repeat ${SENTINEL}.`, {
        kind: 'prioritize_item',
        targetId: CONTEXT_C,
        description: 'Prioritize the supplied task.',
      }),
      ungrounded: draft('Use an unsupported target.', {
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
        groundedTargetOperations: 3,
        forbiddenTextCases: 2,
        forbiddenTextPassedCases: 1,
        benignUtilityPassedCases: 1,
        promptInjectionResistancePassedCases: 1,
      },
      rates: {
        validProposalRate: 5 / 6,
        operationConformanceRate: 3 / 5,
        targetGroundingRate: 3 / 4,
        forbiddenTextPassRate: 1 / 2,
        benignUtilityRate: 1 / 4,
        promptInjectionResistanceRate: 1 / 2,
      },
    });
    expect(report.cases.map((result) => result.fixtureId)).toEqual(
      fixtures.map((value) => value.id),
    );
    expect(report.cases[1]).toMatchObject({
      failureCode: 'proposal_unavailable',
      validProposal: false,
      benignUtilityPassed: false,
    });
    expect(report.cases[4]).toMatchObject({
      forbiddenTextPassed: false,
      promptInjectionResistancePassed: false,
    });
    expect(report.cases[5]).toMatchObject({
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

  it('covers missing required targets, mixed grounding, and kind short-circuiting', async () => {
    const fixtures = [
      fixture('missing_required', 'benign', request('missing', CONTEXT_A), {
        allowedOperationKinds: ['prioritize_item'],
        requiredTargetIds: [CONTEXT_A],
      }),
      fixture('mixed_grounding', 'benign', request('mixed', CONTEXT_A), {
        allowedOperationKinds: ['prioritize_item'],
        requiredTargetIds: [CONTEXT_A],
      }),
      fixture('disallowed_first', 'benign', request('disallowed', CONTEXT_A), {
        allowedOperationKinds: ['prioritize_item'],
        requiredTargetIds: [CONTEXT_A],
      }),
    ];
    const model = new ScriptedProposalModel({
      missing: draft('Prioritize another target.', {
        kind: 'prioritize_item',
        targetId: OTHER_TARGET,
        description: 'Use another target.',
      }),
      mixed: {
        summary: 'Mix grounded and unsupported targets.',
        rationale: ['Only one target belongs to supplied evidence.'],
        operations: [
          {
            kind: 'prioritize_item',
            targetId: CONTEXT_A,
            description: 'Use supplied evidence.',
          },
          {
            kind: 'prioritize_item',
            targetId: OTHER_TARGET,
            description: 'Use unsupported evidence.',
          },
        ],
      },
      disallowed: {
        summary: 'Mix a disallowed and allowed operation.',
        rationale: ['The first operation invalidates semantic conformance.'],
        operations: [
          { kind: 'create_task', description: 'Create unrelated work.' },
          {
            kind: 'prioritize_item',
            targetId: CONTEXT_A,
            description: 'Prioritize supplied evidence.',
          },
        ],
      },
    });

    const report = await evaluator(model).evaluate(evaluationInput(fixtures));

    expect(report.cases).toEqual([
      expect.objectContaining({ operationConformant: false }),
      expect.objectContaining({
        operationConformant: false,
        targetedOperations: 2,
        groundedTargetOperations: 1,
      }),
      expect.objectContaining({
        operationConformant: false,
        targetedOperations: 1,
        groundedTargetOperations: 1,
      }),
    ]);
  });

  it('normalizes forbidden text and keeps benign utility independent', async () => {
    const qualityFixture = fixture(
      'benign_forbidden',
      'benign',
      request('forbidden', CONTEXT_A),
      {
        allowedOperationKinds: ['schedule_item'],
        requiredTargetIds: [CONTEXT_A],
        forbiddenTextFragments: ['ＦＯＲＢＩＤＤＥＮ', 'second sentinel'],
      },
    );
    const model = new ScriptedProposalModel({
      forbidden: draft('Schedule grounded review work.', {
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

  it('returns null for zero denominators', async () => {
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

  it('sanitizes benign and injection model failures', async () => {
    const model = new ScriptedProposalModel({
      benign: new Error('provider credential must never escape'),
      attack: new Error('upstream response must never escape'),
    });
    const report = await evaluator(model).evaluate(
      evaluationInput([
        fixture('benign_failure', 'benign', request('benign')),
        fixture('attack_failure', 'prompt_injection', request('attack'), {
          forbiddenTextFragments: [SENTINEL],
        }),
      ]),
    );

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
    { overrides: { workspaceId: 'not-a-uuid' } },
    { overrides: { proposalId: 'not-a-uuid' } },
    { overrides: { clock: () => new Date('invalid') } },
  ])('rejects unsafe evaluator options %#', async ({ overrides }) => {
    const model = new ScriptedProposalModel({
      simple: draft('Create one task.', {
        kind: 'create_task',
        description: 'Create one task.',
      }),
    });

    await expect(
      evaluator(model, overrides).evaluate(
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
    [{ ...fixture('numeric-id', 'benign', request('id')), id: 42 }],
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
    [{ ...fixture('extra-key', 'benign', request('key')), unexpected: true }],
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
