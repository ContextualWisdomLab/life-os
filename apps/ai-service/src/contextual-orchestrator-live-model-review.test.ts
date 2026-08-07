import { describe, expect, it } from 'vitest';
import {
  ContextualOrchestratorLiveProposalModel,
  createContextualOrchestratorLiveConfiguration,
  LiveConformanceModelError,
  type LiveConformanceProfile,
} from './contextual-orchestrator-live-model';
import type { ContextualOrchestratorFetch } from './contextual-orchestrator-proposal-model';
import type { ProposalRequest } from './proposal-service';

const TOKEN = Buffer.alloc(32, 0x52).toString('base64url');
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

/** Creates one successful orchestrator envelope containing untrusted metadata. */
function response(mode: 'route' | 'conduct', trace: unknown): Response {
  return Response.json({
    choices: [{ message: { content: JSON.stringify(DRAFT) } }],
    orchestration: { mode, trace },
  });
}

/** Creates one live model over a deterministic response and monotonic clock. */
function model(
  profile: LiveConformanceProfile,
  nextResponse: Response,
): ContextualOrchestratorLiveProposalModel {
  const fetcher: ContextualOrchestratorFetch = async () => nextResponse;
  const times = [10, 25];
  return new ContextualOrchestratorLiveProposalModel(
    createContextualOrchestratorLiveConfiguration(
      {
        CONTEXTUAL_ORCHESTRATOR_LIVE_URL: 'http://127.0.0.1:8765',
        CONTEXTUAL_ORCHESTRATOR_LIVE_TOKEN: TOKEN,
      },
      profile,
    ),
    fetcher,
    () => times.shift() ?? 25,
  );
}

/** Requires one sanitized evaluation failure and returns its stable code. */
async function failureCode(
  operation: Promise<unknown>,
): Promise<LiveConformanceModelError['code']> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(LiveConformanceModelError);
    return (error as LiveConformanceModelError).code;
  }
  throw new Error('Expected live conformance failure');
}

describe('live conformance review regressions', () => {
  it('rejects an observed orchestration mode that differs from the requested profile', async () => {
    const subject = model(ROUTE_HIGH, response('conduct', []));

    await expect(failureCode(subject.generate(REQUEST))).resolves.toBe(
      'evaluation_failed',
    );
    expect(subject.observations()).toEqual([
      expect.objectContaining({
        profileId: 'route_high',
        mode: 'route',
        failureCode: 'evaluation_failed',
      }),
    ]);
  });

  for (const [name, trace] of [
    [
      'current-step reference',
      [{ role: 'worker', agent_id: 'worker_0', access: [0], output: 'x' }],
    ],
    [
      'future-step reference',
      [
        { role: 'worker', agent_id: 'worker_0', access: [], output: 'x' },
        { role: 'worker', agent_id: 'worker_1', access: [1], output: 'x' },
      ],
    ],
    [
      'duplicate prior-step reference',
      [
        { role: 'worker', agent_id: 'worker_0', access: [], output: 'x' },
        {
          role: 'worker',
          agent_id: 'worker_1',
          access: [0, 0],
          output: 'x',
        },
      ],
    ],
  ] as const) {
    it(`rejects ${name}`, async () => {
      const subject = model(CONDUCT, response('conduct', trace));

      await expect(failureCode(subject.generate(REQUEST))).resolves.toBe(
        'evaluation_failed',
      );
    });
  }

  it('rejects a validly ordered trace whose aggregate access edges exceed the cap', async () => {
    const trace = Array.from({ length: 32 }, (_unused, stepIndex) => ({
      role: 'worker',
      agent_id: `worker_${stepIndex}`,
      access: Array.from({ length: stepIndex }, (_value, index) => index),
      output: 'x',
    }));
    const subject = model(CONDUCT, response('conduct', trace));

    await expect(failureCode(subject.generate(REQUEST))).resolves.toBe(
      'evaluation_failed',
    );
  });
});
