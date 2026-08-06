import { describe, expect, it, vi } from 'vitest';
import {
  ContextualOrchestratorLiveProposalModel,
  createContextualOrchestratorLiveConfiguration,
  LiveConformanceModelError,
  validateLiveConformanceProfile,
  type LiveConformanceProfile,
} from './contextual-orchestrator-live-model';
import type { ContextualOrchestratorFetch } from './contextual-orchestrator-proposal-model';
import type { ProposalRequest } from './proposal-service';

const TOKEN = Buffer.alloc(32, 0x4e).toString('base64url');
const TASK_ID = '11111111-1111-4111-8111-111111111111';
const request: ProposalRequest = {
  objective: 'Review the most important launch task.',
  context: [
    {
      id: TASK_ID,
      kind: 'task',
      title: 'Verify launch readiness',
      status: 'active',
    },
  ],
};
const draft = {
  summary: 'Prioritize launch readiness.',
  rationale: ['The active task is the critical path.'],
  operations: [
    {
      kind: 'prioritize_item',
      targetId: TASK_ID,
      description: 'Prioritize launch readiness for explicit review.',
    },
  ],
};
const routeHigh: LiveConformanceProfile = {
  profileId: 'route_high',
  mode: 'route',
  structuredOutput: true,
  reasoningEffort: 'high',
};
const routeLow: LiveConformanceProfile = {
  profileId: 'route_low',
  mode: 'route',
  structuredOutput: true,
  reasoningEffort: 'low',
};
const conductTemplate: LiveConformanceProfile = {
  profileId: 'conduct_template',
  mode: 'conduct',
  structuredOutput: false,
  reasoningEffort: null,
};

/** Returns one complete live-only environment with optional overrides. */
function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
    CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
    ...overrides,
  };
}

/** Creates one OpenAI-compatible response with optional orchestration evidence. */
function completionResponse(input: {
  content?: unknown;
  orchestration?: unknown;
  usage?: unknown;
  status?: number;
} = {}): Response {
  return Response.json(
    {
      choices: [
        {
          message: {
            content: input.content ?? JSON.stringify(draft),
          },
        },
      ],
      ...(input.orchestration === undefined
        ? {}
        : { orchestration: input.orchestration }),
      ...(input.usage === undefined ? {} : { usage: input.usage }),
    },
    { status: input.status ?? 200 },
  );
}

/** Builds one model and records its deterministic clock calls. */
function modelWithResponse(
  profile: LiveConformanceProfile,
  response: Response,
  clockValues: number[] = [10, 25],
): {
  model: ContextualOrchestratorLiveProposalModel;
  fetcher: ReturnType<typeof vi.fn<ContextualOrchestratorFetch>>;
} {
  const fetcher = vi.fn<ContextualOrchestratorFetch>(async () => response);
  const values = [...clockValues];
  return {
    model: new ContextualOrchestratorLiveProposalModel(
      createContextualOrchestratorLiveConfiguration(environment(), profile),
      fetcher,
      () => values.shift() ?? 0,
    ),
    fetcher,
  };
}

/** Captures one stable live-model failure without exposing nested details. */
async function failureCode(
  operation: Promise<unknown>,
): Promise<LiveConformanceModelError['code']> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(LiveConformanceModelError);
    return (error as LiveConformanceModelError).code;
  }
  throw new Error('Expected live model failure');
}

describe('live conformance configuration', () => {
  it('accepts and freezes route and conduct profiles with bounded defaults', () => {
    for (const profile of [routeLow, routeHigh, conductTemplate]) {
      const validated = validateLiveConformanceProfile(profile);
      const configuration = createContextualOrchestratorLiveConfiguration(
        environment(),
        profile,
      );

      expect(validated).toEqual(profile);
      expect(Object.isFrozen(validated)).toBe(true);
      expect(configuration).toEqual({
        origin: 'http://127.0.0.1:8765/',
        token: TOKEN,
        timeoutMilliseconds: 30_000,
        profile,
      });
      expect(Object.isFrozen(configuration)).toBe(true);
      expect(Object.isFrozen(configuration.profile)).toBe(true);
    }
    expect(
      createContextualOrchestratorLiveConfiguration(
        environment({ AI_LIVE_MODEL_REQUEST_TIMEOUT_MS: '120000' }),
        routeHigh,
      ).timeoutMilliseconds,
    ).toBe(120_000);
    expect(
      createContextualOrchestratorLiveConfiguration(
        environment({ AI_LIVE_MODEL_REQUEST_TIMEOUT_MS: ' ' }),
        routeHigh,
      ).timeoutMilliseconds,
    ).toBe(30_000);
  });

  it.each([
    {},
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: '' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: ' http://127.0.0.1:1' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:1 ' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'not a url' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'https://127.0.0.1:8765' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://localhost:8765' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.2:8765' }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://user:pass@127.0.0.1:8765',
    }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765/path',
    }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765?query=1',
    }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765/#fragment',
    }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: undefined }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: ' short' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: 'short ' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: 'short' }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: `x${String.fromCharCode(0)}${'y'.repeat(31)}`,
    }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: 'x'.repeat(4097) }),
    environment({ AI_LIVE_MODEL_REQUEST_TIMEOUT_MS: '99' }),
    environment({ AI_LIVE_MODEL_REQUEST_TIMEOUT_MS: '120001' }),
    environment({ AI_LIVE_MODEL_REQUEST_TIMEOUT_MS: '1.5' }),
  ])('rejects unsafe environment without retaining inputs %#', (value) => {
    expect(() =>
      createContextualOrchestratorLiveConfiguration(value, routeHigh),
    ).toThrow(LiveConformanceModelError);
  });

  it.each([
    null,
    { ...routeHigh, profileId: '' },
    { ...routeHigh, profileId: 'Route-High' },
    { ...routeHigh, mode: 'auto' },
    { ...routeHigh, structuredOutput: 'yes' },
    { ...routeHigh, reasoningEffort: 'medium' },
    { ...routeHigh, structuredOutput: false },
    { ...routeHigh, reasoningEffort: null },
    { ...conductTemplate, structuredOutput: true },
    { ...conductTemplate, reasoningEffort: 'high' },
  ])('rejects inconsistent profile %#', (profile) => {
    expect(() =>
      validateLiveConformanceProfile(profile as never),
    ).toThrow(LiveConformanceModelError);
  });
});

describe('live conformance request and evidence boundary', () => {
  it('sends one high-effort structured route and records bounded usage', async () => {
    const { model, fetcher } = modelWithResponse(
      routeHigh,
      completionResponse({
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          completion_tokens_details: { reasoning_tokens: 30 },
        },
      }),
    );

    await expect(model.generate(request)).resolves.toEqual(draft);
    expect(fetcher).toHaveBeenCalledOnce();
    const [target, init] = fetcher.mock.calls[0] ?? [];
    expect(String(target)).toBe('http://127.0.0.1:8765/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'contextual-orchestrator',
      orchestration_mode: 'route',
      include_orchestration_trace: true,
      temperature: 0,
      stream: false,
      reasoning_effort: 'high',
    });
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        name: 'life_os_inert_proposal_draft',
        strict: true,
      },
    });
    expect(body.tools).toBeUndefined();
    expect(body.messages).toEqual([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: JSON.stringify(request) },
    ]);

    expect(model.observations()).toEqual([
      {
        profileId: 'route_high',
        mode: 'route',
        workflowDepth: 0,
        roleCounts: {},
        contributingSteps: 0,
        verifierPresent: false,
        verifierVerdict: null,
        accessEdgeCount: 0,
        maximumAccessFanIn: 0,
        distinctAgentCount: 0,
        planSource: 'unknown',
        elapsedMilliseconds: 15,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          reasoningTokens: 30,
        },
        failureCode: null,
      },
    ]);
    expect(Object.isFrozen(model.observations())).toBe(true);
    expect(Object.isFrozen(model.observations()[0])).toBe(true);
  });

  it('sends conduct without provider-native structured output and aggregates trace', async () => {
    const trace = [
      {
        id: 0,
        role: 'thinker',
        agent_id: 'reasoning_agent',
        subtask: 'private subtask must not be retained',
        access: [],
        output: 'draft with api_key=super-secret-value',
      },
      {
        id: 1,
        role: 'worker',
        agent_id: 'writing_agent',
        access: [0],
        output: 'candidate',
      },
      {
        id: 2,
        role: 'verifier',
        agent_id: 'review_agent',
        access: [0, 1],
        output: 'Verified and accepted.',
      },
      {
        id: 3,
        role: 'synthesizer',
        agent_id: 'writing_agent',
        access: [1, 2],
        output: JSON.stringify(draft),
      },
    ];
    const { model, fetcher } = modelWithResponse(
      conductTemplate,
      completionResponse({
        orchestration: {
          mode: 'conduct',
          workflow_run_id: 'must-not-be-retained',
          plan_source: 'template',
          trace,
        },
        usage: { reasoning_tokens: 12 },
      }),
    );

    await expect(model.generate(request)).resolves.toEqual(draft);
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)) as Record<
      string,
      unknown
    >;
    expect(body.orchestration_mode).toBe('conduct');
    expect(body.response_format).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();

    const [observed] = model.observations();
    expect(observed).toEqual({
      profileId: 'conduct_template',
      mode: 'conduct',
      workflowDepth: 4,
      roleCounts: { thinker: 1, worker: 1, verifier: 1, synthesizer: 1 },
      contributingSteps: 4,
      verifierPresent: true,
      verifierVerdict: 'accepted',
      accessEdgeCount: 5,
      maximumAccessFanIn: 2,
      distinctAgentCount: 3,
      planSource: 'template',
      elapsedMilliseconds: 15,
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        reasoningTokens: 12,
      },
      failureCode: null,
    });
    const serialized = JSON.stringify(observed);
    for (const forbidden of [
      'private subtask',
      'super-secret-value',
      'must-not-be-retained',
      'reasoning_agent',
      'writing_agent',
      'review_agent',
      'Prioritize launch readiness',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it.each([
    ['Rejected as unsafe.', 'rejected'],
    ['No clear verdict.', 'unknown'],
    ['', 'unknown'],
  ] as const)('classifies verifier output %s as %s', async (output, verdict) => {
    const { model } = modelWithResponse(
      conductTemplate,
      completionResponse({
        orchestration: {
          mode: 'conduct',
          plan_source: 'generated',
          trace: [
            {
              role: 'verifier',
              agent_id: 'review_agent',
              access: [],
              output,
            },
          ],
        },
      }),
    );

    await model.generate(request);
    expect(model.observations()[0]?.verifierVerdict).toBe(verdict);
    expect(model.observations()[0]?.planSource).toBe('generated');
  });

  it('uses fallback mode and unknown plan source for malformed optional metadata', async () => {
    const { model } = modelWithResponse(
      routeLow,
      completionResponse({
        orchestration: { mode: 'auto', plan_source: 'other' },
        usage: {
          prompt_tokens: -1,
          completion_tokens: 1.5,
          total_tokens: Number.MAX_SAFE_INTEGER,
          reasoning_tokens: 'secret',
          completion_tokens_details: [],
        },
      }),
    );

    await model.generate(request);
    expect(model.observations()[0]).toMatchObject({
      mode: 'route',
      planSource: 'unknown',
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        reasoningTokens: null,
      },
    });
  });

  it('constructs with production Fetch and clock defaults without performing I/O', () => {
    expect(
      new ContextualOrchestratorLiveProposalModel(
        createContextualOrchestratorLiveConfiguration(environment(), routeHigh),
      ),
    ).toBeInstanceOf(ContextualOrchestratorLiveProposalModel);
  });
});

describe('live conformance failure evidence', () => {
  it.each([
    [429, 'provider_unavailable'],
    [500, 'provider_unavailable'],
    [400, 'orchestrator_unavailable'],
  ] as const)('classifies HTTP %i as %s', async (status, expected) => {
    const { model } = modelWithResponse(
      routeHigh,
      new Response('private provider body', { status }),
    );

    expect(await failureCode(model.generate(request))).toBe(expected);
    expect(model.observations()).toHaveLength(1);
    expect(model.observations()[0]).toMatchObject({
      failureCode: expected,
      workflowDepth: 0,
      elapsedMilliseconds: 15,
    });
    expect(JSON.stringify(model.observations())).not.toContain('private provider');
  });

  it.each([
    new Response(null, { status: 200 }),
    new Response('x'.repeat(65_537), { status: 200 }),
    new Response(new Uint8Array([0xff]), { status: 200 }),
    new Response('{', { status: 200 }),
    new Response('null', { status: 200 }),
    Response.json({ choices: [] }),
    completionResponse({ content: 'null' }),
  ])('fails closed for malformed response %#', async (response) => {
    const { model } = modelWithResponse(routeHigh, response);

    expect(await failureCode(model.generate(request))).toBe('evaluation_failed');
    expect(model.observations().at(-1)?.failureCode).toBe('evaluation_failed');
  });

  it.each([
    Array.from({ length: 33 }, () => ({
      role: 'worker',
      agent_id: 'worker_agent',
      access: [],
      output: 'x',
    })),
    [{ role: 'x', agent_id: 'worker_agent', access: [], output: 'x' }],
    [{ role: 'worker', agent_id: '', access: [], output: 'x' }],
    [
      {
        role: 'worker',
        agent_id: 'worker_agent',
        access: 'not-an-array',
        output: 'x',
      },
    ],
    [
      {
        role: 'worker',
        agent_id: 'worker_agent',
        access: [-1],
        output: 'x',
      },
    ],
    [
      {
        role: 'worker',
        agent_id: 'worker_agent',
        access: Array.from({ length: 257 }, (_, index) => index),
        output: 'x',
      },
    ],
    [null],
  ])('rejects unsafe trace evidence %#', async (trace) => {
    const { model } = modelWithResponse(
      conductTemplate,
      completionResponse({ orchestration: { mode: 'conduct', trace } }),
    );

    expect(await failureCode(model.generate(request))).toBe('evaluation_failed');
    expect(model.observations().at(-1)?.failureCode).toBe('evaluation_failed');
  });

  it('sanitizes fetch failures and invalid monotonic clocks', async () => {
    const fetchFailure: ContextualOrchestratorFetch = async () => {
      throw new Error(`provider leaked ${TOKEN}`);
    };
    const failing = new ContextualOrchestratorLiveProposalModel(
      createContextualOrchestratorLiveConfiguration(environment(), routeHigh),
      fetchFailure,
      (() => {
        const values = [10, 20];
        return () => values.shift() ?? 0;
      })(),
    );
    expect(await failureCode(failing.generate(request))).toBe(
      'orchestrator_unavailable',
    );
    expect(JSON.stringify(failing.observations())).not.toContain(TOKEN);

    const { model: negativeClock } = modelWithResponse(
      routeHigh,
      completionResponse(),
      [20, 10, 20, 10],
    );
    expect(await failureCode(negativeClock.generate(request))).toBe(
      'evaluation_failed',
    );
    expect(negativeClock.observations().at(-1)?.elapsedMilliseconds).toBe(0);

    const { model: infiniteClock } = modelWithResponse(
      routeHigh,
      completionResponse(),
      [10, Number.POSITIVE_INFINITY, 10, Number.POSITIVE_INFINITY],
    );
    expect(await failureCode(infiniteClock.generate(request))).toBe(
      'evaluation_failed',
    );
    expect(infiniteClock.observations().at(-1)?.elapsedMilliseconds).toBe(0);
  });
});
