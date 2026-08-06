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
const REQUEST: ProposalRequest = {
  objective: 'Review launch readiness.',
  context: [
    {
      id: TASK_ID,
      kind: 'task',
      title: 'Verify launch readiness',
      status: 'active',
    },
  ],
};
const DRAFT = {
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
const ROUTE_HIGH: LiveConformanceProfile = {
  profileId: 'route_high',
  mode: 'route',
  structuredOutput: true,
  reasoningEffort: 'high',
};
const CONDUCT: LiveConformanceProfile = {
  profileId: 'conduct_template',
  mode: 'conduct',
  structuredOutput: false,
  reasoningEffort: null,
};

function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
    CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
    ...overrides,
  };
}

function response(input: {
  status?: number;
  content?: unknown;
  orchestration?: unknown;
  usage?: unknown;
} = {}): Response {
  return Response.json(
    {
      choices: [
        {
          message: {
            content: input.content ?? JSON.stringify(DRAFT),
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

function model(
  profile: LiveConformanceProfile,
  nextResponse: Response,
  times: number[] = [10, 25],
): {
  model: ContextualOrchestratorLiveProposalModel;
  fetcher: ReturnType<typeof vi.fn<ContextualOrchestratorFetch>>;
} {
  const fetcher = vi.fn<ContextualOrchestratorFetch>(async () => nextResponse);
  const clock = [...times];
  return {
    model: new ContextualOrchestratorLiveProposalModel(
      createContextualOrchestratorLiveConfiguration(environment(), profile),
      fetcher,
      () => clock.shift() ?? 0,
    ),
    fetcher,
  };
}

async function code(
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
  it('freezes valid route and conduct profiles and parses timeout bounds', () => {
    for (const profile of [ROUTE_HIGH, CONDUCT]) {
      expect(Object.isFrozen(validateLiveConformanceProfile(profile))).toBe(true);
      const configured = createContextualOrchestratorLiveConfiguration(
        environment(),
        profile,
      );
      expect(configured).toMatchObject({
        origin: 'http://127.0.0.1:8765/',
        token: TOKEN,
        timeoutMilliseconds: 30_000,
        profile,
      });
      expect(Object.isFrozen(configured)).toBe(true);
      expect(Object.isFrozen(configured.profile)).toBe(true);
    }
    expect(
      createContextualOrchestratorLiveConfiguration(
        environment({ AI_LIVE_MODEL_REQUEST_TIMEOUT_MS: '120000' }),
        ROUTE_HIGH,
      ).timeoutMilliseconds,
    ).toBe(120_000);
    expect(
      createContextualOrchestratorLiveConfiguration(
        environment({ AI_LIVE_MODEL_REQUEST_TIMEOUT_MS: ' ' }),
        ROUTE_HIGH,
      ).timeoutMilliseconds,
    ).toBe(30_000);
  });

  const invalidEnvironments: ReadonlyArray<
    Readonly<Record<string, string | undefined>>
  > = [
    {},
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: '' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: ' http://127.0.0.1:1' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:1 ' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'not-a-url' }),
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
  ];
  for (const [index, value] of invalidEnvironments.entries()) {
    it(`rejects unsafe environment ${index}`, () => {
      expect(() =>
        createContextualOrchestratorLiveConfiguration(value, ROUTE_HIGH),
      ).toThrow(LiveConformanceModelError);
    });
  }

  const invalidProfiles: unknown[] = [
    null,
    { ...ROUTE_HIGH, profileId: '' },
    { ...ROUTE_HIGH, profileId: 'Route-High' },
    { ...ROUTE_HIGH, mode: 'auto' },
    { ...ROUTE_HIGH, structuredOutput: 'yes' },
    { ...ROUTE_HIGH, reasoningEffort: 'medium' },
    { ...ROUTE_HIGH, structuredOutput: false },
    { ...ROUTE_HIGH, reasoningEffort: null },
    { ...CONDUCT, structuredOutput: true },
    { ...CONDUCT, reasoningEffort: 'high' },
  ];
  for (const [index, value] of invalidProfiles.entries()) {
    it(`rejects inconsistent profile ${index}`, () => {
      expect(() => validateLiveConformanceProfile(value as never)).toThrow(
        LiveConformanceModelError,
      );
    });
  }
});

describe('live conformance transport', () => {
  it('sends a structured high-effort route and records usage', async () => {
    const fixture = model(
      ROUTE_HIGH,
      response({
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          completion_tokens_details: { reasoning_tokens: 30 },
        },
      }),
    );
    await expect(fixture.model.generate(REQUEST)).resolves.toEqual(DRAFT);
    const [target, init] = fixture.fetcher.mock.calls[0] ?? [];
    expect(String(target)).toBe('http://127.0.0.1:8765/v1/chat/completions');
    expect(init?.redirect).toBe('error');
    expect(init?.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      model: 'contextual-orchestrator',
      orchestration_mode: 'route',
      include_orchestration_trace: true,
      reasoning_effort: 'high',
      temperature: 0,
      stream: false,
    });
    expect(body.response_format).toBeDefined();
    expect(fixture.model.observations()).toEqual([
      expect.objectContaining({
        profileId: 'route_high',
        mode: 'route',
        workflowDepth: 0,
        elapsedMilliseconds: 15,
        usage: {
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          reasoningTokens: 30,
        },
        failureCode: null,
      }),
    ]);
    expect(Object.isFrozen(fixture.model.observations())).toBe(true);
  });

  it('sends conduct without structured passthrough and sanitizes trace', async () => {
    const fixture = model(
      CONDUCT,
      response({
        orchestration: {
          mode: 'conduct',
          workflow_run_id: 'never-retained',
          plan_source: 'template',
          trace: [
            {
              role: 'thinker',
              agent_id: 'reasoning_agent',
              access: [],
              output: 'private secret draft',
            },
            {
              role: 'worker',
              agent_id: 'writing_agent',
              access: [0],
              output: 'candidate',
            },
            {
              role: 'verifier',
              agent_id: 'review_agent',
              access: [0, 1],
              output: 'Verified and accepted.',
            },
            {
              role: 'synthesizer',
              agent_id: 'writing_agent',
              access: [1, 2],
              output: JSON.stringify(DRAFT),
            },
          ],
        },
        usage: { reasoning_tokens: 12 },
      }),
    );
    await fixture.model.generate(REQUEST);
    const body = JSON.parse(
      String(fixture.fetcher.mock.calls[0]?.[1]?.body),
    ) as Record<string, unknown>;
    expect(body.response_format).toBeUndefined();
    expect(body.reasoning_effort).toBeUndefined();
    const observed = fixture.model.observations()[0];
    expect(observed).toMatchObject({
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
      usage: { reasoningTokens: 12 },
    });
    const serialized = JSON.stringify(observed);
    for (const forbidden of [
      'never-retained',
      'private secret',
      'reasoning_agent',
      'writing_agent',
      'review_agent',
      'Prioritize launch readiness',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  for (const [output, verdict] of [
    ['Rejected as unsafe.', 'rejected'],
    ['No clear verdict.', 'unknown'],
    ['', 'unknown'],
  ] as const) {
    it(`classifies verifier verdict ${verdict}`, async () => {
      const fixture = model(
        CONDUCT,
        response({
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
      await fixture.model.generate(REQUEST);
      expect(fixture.model.observations()[0]).toMatchObject({
        verifierVerdict: verdict,
        planSource: 'generated',
      });
    });
  }

  it('falls back for malformed optional metadata and invalid usage counters', async () => {
    const fixture = model(
      ROUTE_HIGH,
      response({
        orchestration: { mode: 'auto', plan_source: 'other' },
        usage: {
          prompt_tokens: -1,
          completion_tokens: 1.5,
          total_tokens: Number.MAX_SAFE_INTEGER,
          reasoning_tokens: 'private',
          completion_tokens_details: [],
        },
      }),
    );
    await fixture.model.generate(REQUEST);
    expect(fixture.model.observations()[0]).toMatchObject({
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

  it('constructs with production defaults without I/O', () => {
    expect(
      new ContextualOrchestratorLiveProposalModel(
        createContextualOrchestratorLiveConfiguration(environment(), ROUTE_HIGH),
      ),
    ).toBeInstanceOf(ContextualOrchestratorLiveProposalModel);
  });
});

describe('live conformance failure evidence', () => {
  for (const [status, expected] of [
    [429, 'provider_unavailable'],
    [500, 'provider_unavailable'],
    [400, 'orchestrator_unavailable'],
  ] as const) {
    it(`classifies HTTP ${status}`, async () => {
      const fixture = model(
        ROUTE_HIGH,
        new Response('private body', { status }),
      );
      expect(await code(fixture.model.generate(REQUEST))).toBe(expected);
      expect(fixture.model.observations().at(-1)).toMatchObject({
        failureCode: expected,
        elapsedMilliseconds: 15,
      });
      expect(JSON.stringify(fixture.model.observations())).not.toContain(
        'private body',
      );
    });
  }

  const malformedResponses: Response[] = [
    new Response(null, { status: 200 }),
    new Response('x'.repeat(65_537), { status: 200 }),
    new Response(new Uint8Array([0xff]), { status: 200 }),
    new Response('{', { status: 200 }),
    new Response('null', { status: 200 }),
    Response.json({ choices: [] }),
    response({ content: 'null' }),
  ];
  for (const [index, nextResponse] of malformedResponses.entries()) {
    it(`rejects malformed response ${index}`, async () => {
      const fixture = model(ROUTE_HIGH, nextResponse);
      expect(await code(fixture.model.generate(REQUEST))).toBe(
        'evaluation_failed',
      );
      expect(fixture.model.observations().at(-1)?.failureCode).toBe(
        'evaluation_failed',
      );
    });
  }

  const unsafeTraces: unknown[] = [
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
  ];
  for (const [index, trace] of unsafeTraces.entries()) {
    it(`rejects unsafe trace ${index}`, async () => {
      const fixture = model(
        CONDUCT,
        response({ orchestration: { mode: 'conduct', trace } }),
      );
      expect(await code(fixture.model.generate(REQUEST))).toBe(
        'evaluation_failed',
      );
    });
  }

  it('sanitizes network failures and invalid monotonic clocks', async () => {
    const fetchFailure: ContextualOrchestratorFetch = async () => {
      throw new Error(`provider leaked ${TOKEN}`);
    };
    const values = [10, 20];
    const failing = new ContextualOrchestratorLiveProposalModel(
      createContextualOrchestratorLiveConfiguration(environment(), ROUTE_HIGH),
      fetchFailure,
      () => values.shift() ?? 0,
    );
    expect(await code(failing.generate(REQUEST))).toBe(
      'orchestrator_unavailable',
    );
    expect(JSON.stringify(failing.observations())).not.toContain(TOKEN);

    for (const times of [
      [20, 10, 20, 10],
      [10, Number.POSITIVE_INFINITY, 10, Number.POSITIVE_INFINITY],
    ]) {
      const fixture = model(ROUTE_HIGH, response(), times);
      expect(await code(fixture.model.generate(REQUEST))).toBe(
        'evaluation_failed',
      );
      expect(fixture.model.observations().at(-1)?.elapsedMilliseconds).toBe(0);
    }
  });
});
