import { describe, expect, it, vi } from 'vitest';
import {
  type ContextualOrchestratorFetch,
  ContextualOrchestratorProposalModel,
  createContextualOrchestratorConfiguration,
  ProposalModelTransportError,
} from './contextual-orchestrator-proposal-model';
import type { ProposalRequest } from './proposal-service';

const TOKEN = Buffer.alloc(32, 0x54).toString('base64url');
const TASK_ID = 'f6bd6684-8fa2-45ff-b0ef-3f5ef847ed4b';
const request: ProposalRequest = {
  objective: 'Prepare the most important work for today',
  context: [
    {
      id: TASK_ID,
      kind: 'task',
      title: 'Draft the launch checklist',
      status: 'active',
    },
  ],
};

/** Builds one successful OpenAI-compatible completion response. */
function completion(content: unknown): Response {
  return new Response(
    JSON.stringify({
      id: 'completion-test',
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content } }],
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' },
    },
  );
}

/** Creates the valid external-model environment used by transport tests. */
function environment(
  overrides: Readonly<Record<string, string | undefined>> = {},
): Readonly<Record<string, string | undefined>> {
  return {
    CONTEXTUAL_ORCHESTRATOR_URL: 'https://orchestrator.example.test',
    CONTEXTUAL_ORCHESTRATOR_TOKEN: TOKEN,
    ...overrides,
  };
}

/** Creates the default parsed configuration for one adapter test. */
function configuration() {
  return createContextualOrchestratorConfiguration(environment());
}

describe('contextual orchestrator configuration', () => {
  it('accepts an exact HTTPS origin and bounded timeout', () => {
    const configured = createContextualOrchestratorConfiguration(
      environment({ AI_MODEL_REQUEST_TIMEOUT_MS: '30000' }),
    );

    expect(configured.origin.href).toBe(
      'https://orchestrator.example.test/',
    );
    expect(configured.token).toBe(TOKEN);
    expect(configured.timeoutMilliseconds).toBe(30_000);
    expect(Object.isFrozen(configured)).toBe(true);
    expect(
      createContextualOrchestratorConfiguration(environment())
        .timeoutMilliseconds,
    ).toBe(10_000);
    expect(
      createContextualOrchestratorConfiguration(
        environment({ AI_MODEL_REQUEST_TIMEOUT_MS: ' ' }),
      ).timeoutMilliseconds,
    ).toBe(10_000);
  });

  it.each([
    {},
    environment({ CONTEXTUAL_ORCHESTRATOR_URL: 'not a url' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_URL: 'http://example.test' }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_URL: 'https://user:pass@example.test',
    }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_URL: 'https://example.test/custom',
    }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_URL: 'https://example.test?debug=1',
    }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_URL: 'https://example.test/#fragment',
    }),
    environment({ CONTEXTUAL_ORCHESTRATOR_URL: 'https://localhost' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_URL: 'https://api.localhost' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_URL: 'https://127.0.0.1' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_URL: 'https://[::1]' }),
    environment({ CONTEXTUAL_ORCHESTRATOR_TOKEN: undefined }),
    environment({ CONTEXTUAL_ORCHESTRATOR_TOKEN: 'short' }),
    environment({
      CONTEXTUAL_ORCHESTRATOR_TOKEN: `x${String.fromCharCode(0)}${'y'.repeat(31)}`,
    }),
    environment({ CONTEXTUAL_ORCHESTRATOR_TOKEN: 'x'.repeat(4097) }),
    environment({ AI_MODEL_REQUEST_TIMEOUT_MS: '99' }),
    environment({ AI_MODEL_REQUEST_TIMEOUT_MS: '30001' }),
    environment({ AI_MODEL_REQUEST_TIMEOUT_MS: '1.5' }),
  ])('rejects unsafe configuration without retaining input %#', (value) => {
    let failure: unknown;
    try {
      createContextualOrchestratorConfiguration(value);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(ProposalModelTransportError);
    expect(String(failure)).not.toContain(TOKEN);
    expect(String(failure)).not.toContain('user:pass');
  });
});

describe('ContextualOrchestratorProposalModel', () => {
  it('sends a no-tools schema-constrained request and returns untrusted output', async () => {
    const draft = {
      summary: 'Prioritize launch readiness.',
      rationale: ['The checklist is the active critical path.'],
      operations: [
        {
          kind: 'prioritize_item',
          targetId: TASK_ID,
          description: 'Prioritize the launch checklist for review.',
        },
      ],
    };
    const fetcher = vi.fn<ContextualOrchestratorFetch>(async () =>
      completion(JSON.stringify(draft)),
    );
    const model = new ContextualOrchestratorProposalModel(
      configuration(),
      fetcher,
    );

    await expect(model.generate(request)).resolves.toEqual(draft);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [target, init] = fetcher.mock.calls[0] ?? [];
    expect(String(target)).toBe(
      'https://orchestrator.example.test/v1/chat/completions',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('contextual-orchestrator');
    expect(body.tools).toBeUndefined();
    expect(body.stream).toBe(false);
    expect(body.temperature).toBe(0);
    const messages = body.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(String(messages[0]?.content)).toContain('untrusted data');
    expect(String(messages[0]?.content)).toContain('Never execute');
    expect(messages[1]).toEqual({
      role: 'user',
      content: JSON.stringify(request),
    });

    const responseFormat = body.response_format as Record<string, unknown>;
    expect(responseFormat.type).toBe('json_schema');
    const jsonSchema = responseFormat.json_schema as Record<string, unknown>;
    expect(jsonSchema.name).toBe('life_os_inert_proposal_draft');
    expect(jsonSchema.strict).toBe(true);
    const schema = jsonSchema.schema as Record<string, unknown>;
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['summary', 'rationale', 'operations']);
    const properties = schema.properties as Record<string, unknown>;
    const operations = properties.operations as Record<string, unknown>;
    const operationItem = operations.items as Record<string, unknown>;
    expect(operationItem.oneOf).toHaveLength(3);
    for (const variant of operationItem.oneOf as Array<
      Record<string, unknown>
    >) {
      expect(variant.additionalProperties).toBe(false);
    }
  });

  it.each([
    new Response('upstream body must remain private', {
      status: 429,
      statusText: 'provider secret',
    }),
    new Response(null, { status: 200 }),
    new Response('x'.repeat(65_537), { status: 200 }),
  ])('rejects bounded HTTP and body failures %#', async (response) => {
    const fetcher: ContextualOrchestratorFetch = async () => response;
    const model = new ContextualOrchestratorProposalModel(
      configuration(),
      fetcher,
    );

    let failure: unknown;
    try {
      await model.generate(request);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ProposalModelTransportError);
    expect(String(failure)).not.toContain(TOKEN);
    expect(String(failure)).not.toContain('upstream body');
    expect(String(failure)).not.toContain('provider secret');
  });

  it.each([
    '{}',
    JSON.stringify({ choices: [] }),
    JSON.stringify({ choices: [{}] }),
    JSON.stringify({ choices: [{ message: {} }] }),
    JSON.stringify({ choices: [{ message: { content: 42 } }] }),
    JSON.stringify({ choices: [{ message: { content: ' ' } }] }),
    JSON.stringify({ choices: [{ message: { content: '{' } }] }),
  ])('rejects malformed completion envelope or content %#', async (body) => {
    const fetcher: ContextualOrchestratorFetch = async () =>
      new Response(body, { status: 200 });
    await expect(
      new ContextualOrchestratorProposalModel(
        configuration(),
        fetcher,
      ).generate(request),
    ).rejects.toBeInstanceOf(ProposalModelTransportError);
  });

  it('sanitizes network failures and already-sanitized failures', async () => {
    const networkFailure: ContextualOrchestratorFetch = async () => {
      throw new Error(`network leaked ${TOKEN}`);
    };
    const model = new ContextualOrchestratorProposalModel(
      configuration(),
      networkFailure,
    );

    let failure: unknown;
    try {
      await model.generate(request);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ProposalModelTransportError);
    expect(String(failure)).not.toContain(TOKEN);

    const sanitizedFailure: ContextualOrchestratorFetch = async () => {
      throw new ProposalModelTransportError();
    };
    await expect(
      new ContextualOrchestratorProposalModel(
        configuration(),
        sanitizedFailure,
      ).generate(request),
    ).rejects.toBeInstanceOf(ProposalModelTransportError);
  });
});
