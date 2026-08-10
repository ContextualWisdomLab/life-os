import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composePlanningToday } from './today-composition';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TEST_SIGNING_KEY = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_374_000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function cancellableJson(
  body: unknown,
  status: number,
): { response: Response; wasCancelled: () => boolean } {
  let cancelled = false;
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
      },
      cancel() {
        cancelled = true;
      },
    }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );
  return { response, wasCancelled: () => cancelled };
}

function planningToday(
  actions: readonly unknown[] = [],
): Readonly<Record<string, unknown>> {
  return {
    version: 'life-os.today.v1',
    aggregateId: '22222222-2222-4222-8222-222222222222',
    revision: '33333333-3333-4333-8333-333333333333',
    date: '2026-08-10',
    actions,
  };
}

const ENVIRONMENT = {
  IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
  PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
  PLANNING_GATEWAY_CONTEXT_SECRET: TEST_SIGNING_KEY,
} as const;

async function expectPlanningUnavailable(
  planningResponse: Response,
): Promise<void> {
  const fetcher = async (input: RequestInfo | URL) =>
    String(input).endsWith('/v1/session')
      ? json({ workspaceId: WORKSPACE_ID })
      : planningResponse;
  await expect(
    composePlanningToday(
      'session=opaque',
      '2026-08-10',
      ENVIRONMENT,
      fetcher,
      NOW_SECONDS,
    ),
  ).rejects.toMatchObject({
    status: 503,
    code: 'today_composition_unavailable',
  });
}

async function expectConfigurationUnavailable(
  environment: Parameters<typeof composePlanningToday>[2],
): Promise<void> {
  let called = false;
  await expect(
    composePlanningToday(
      'session=opaque',
      '2026-08-10',
      environment,
      async () => {
        called = true;
        return json({ workspaceId: WORKSPACE_ID });
      },
      NOW_SECONDS,
    ),
  ).rejects.toMatchObject({
    status: 503,
    code: 'today_composition_unavailable',
  });
  expect(called).toBe(false);
}

describe('Gateway planning Today composition', () => {
  it('derives workspace from identity and sends only signed service authority to Planning', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith('/v1/session')) return json({ workspaceId: WORKSPACE_ID });
      return json(planningToday());
    };

    const result = await composePlanningToday(
      'session=opaque',
      '2026-08-10',
      ENVIRONMENT,
      fetcher,
      NOW_SECONDS,
    );

    expect(result).toEqual({
      version: 'life-os.gateway-today.v1',
      date: '2026-08-10',
      planning: planningToday(),
      degraded: ['habits_not_composed'],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://identity.example.test/v1/session');
    expect(calls[0]?.headers.get('cookie')).toBe('session=opaque');
    expect(calls[1]?.url).toBe(
      'https://planning.example.test/v1/today/2026-08-10',
    );
    expect(calls[1]?.headers.get('cookie')).toBeNull();
    expect(calls[1]?.headers.get('x-life-os-workspace-id')).toBe(WORKSPACE_ID);
    expect(calls[1]?.headers.get('x-life-os-context-issued-at')).toBe(
      String(NOW_SECONDS),
    );
    expect(calls[1]?.headers.get('x-life-os-context-signature')).toBe(
      createHmac('sha256', TEST_SIGNING_KEY)
        .update(
          `life-os.workspace.v1\n${WORKSPACE_ID}\n${NOW_SECONDS}`,
          'utf8',
        )
        .digest('base64url'),
    );
  });

  it('validates and canonicalizes Planning action identity before forwarding', async () => {
    const action = {
      id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      title: 'Ship bounded Today composition',
      status: 'open',
    };
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/session')
        ? json({ workspaceId: WORKSPACE_ID })
        : json(planningToday([action]));

    const result = await composePlanningToday(
      'session=opaque',
      '2026-08-10',
      ENVIRONMENT,
      fetcher,
      NOW_SECONDS,
    );

    expect(result.planning.actions).toEqual([
      { ...action, id: action.id.toLowerCase() },
    ]);
    expect(Object.isFrozen(result.planning.actions[0])).toBe(true);
  });

  it.each([
    ['null action', null],
    ['array action', []],
    ['missing action id', { title: 'missing id' }],
    ['invalid action id', { id: 'not-a-uuid' }],
  ])('fails closed on %s evidence', async (_name, action) => {
    await expectPlanningUnavailable(json(planningToday([action])));
  });

  it('rejects problem-json as a successful upstream representation', async () => {
    await expectPlanningUnavailable(
      new Response(JSON.stringify(planningToday()), {
        status: 200,
        headers: { 'content-type': 'application/problem+json' },
      }),
    );
  });

  it('returns an authentication-required failure without calling Planning', async () => {
    const calls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return json({ code: 'authentication_required' }, 401);
    };

    await expect(
      composePlanningToday(
        'session=expired',
        '2026-08-10',
        ENVIRONMENT,
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: 'authentication_required',
    });
    expect(calls).toEqual(['https://identity.example.test/v1/session']);
  });

  it('cancels unread Identity error bodies before returning authentication failure', async () => {
    const identityFailure = cancellableJson(
      { code: 'authentication_required' },
      401,
    );

    await expect(
      composePlanningToday(
        'session=expired',
        '2026-08-10',
        ENVIRONMENT,
        async () => identityFailure.response,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({ status: 401, code: 'authentication_required' });
    expect(identityFailure.wasCancelled()).toBe(true);
  });

  it('maps Planning not-found without fabricating an aggregate', async () => {
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/session')
        ? json({ workspaceId: WORKSPACE_ID })
        : json({ code: 'today_not_found' }, 404);

    await expect(
      composePlanningToday(
        'session=opaque',
        '2026-08-10',
        ENVIRONMENT,
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({ status: 404, code: 'today_not_found' });
  });

  it.each([
    ['identity fetch exception', 0],
    ['planning fetch exception', 1],
  ])('fails closed on %s', async (_name, throwOnCall) => {
    let call = 0;
    const fetcher = async () => {
      if (call === throwOnCall) {
        throw new DOMException('upstream timed out', 'TimeoutError');
      }
      call += 1;
      return json({ workspaceId: WORKSPACE_ID });
    };

    await expect(
      composePlanningToday(
        'session=opaque',
        '2026-08-10',
        ENVIRONMENT,
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'today_composition_unavailable',
    });
  });

  it('does not fabricate success when Planning is unavailable', async () => {
    await expectPlanningUnavailable(json({ error: 'down' }, 503));
  });

  it('cancels unread Planning error bodies before returning dependency failure', async () => {
    const planningFailure = cancellableJson({ error: 'down' }, 503);
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/session')
        ? json({ workspaceId: WORKSPACE_ID })
        : planningFailure.response;

    await expect(
      composePlanningToday(
        'session=opaque',
        '2026-08-10',
        ENVIRONMENT,
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'today_composition_unavailable',
    });
    expect(planningFailure.wasCancelled()).toBe(true);
  });

  it.each([
    [
      'wrong successful media type',
      new Response(JSON.stringify(planningToday()), {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    ],
    [
      'malformed content length',
      new Response(JSON.stringify(planningToday()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': 'unknown',
        },
      }),
    ],
    [
      'declared oversized body',
      new Response(JSON.stringify(planningToday()), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-length': '65537',
        },
      }),
    ],
    [
      'streamed oversized body',
      new Response(new Uint8Array(65_537), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
    [
      'invalid UTF-8 body',
      new Response(Uint8Array.from([0xc3, 0x28]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ],
  ])('fails closed on %s', async (_name, response) => {
    await expectPlanningUnavailable(response);
  });

  it('fails closed on malformed Identity workspace authority', async () => {
    const fetcher = async () => json({ workspaceId: 'not-a-uuid' });
    await expect(
      composePlanningToday(
        'session=opaque',
        '2026-08-10',
        ENVIRONMENT,
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'today_composition_unavailable',
    });
  });

  it('fails closed when Planning exceeds the bounded action count', async () => {
    const action = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    await expectPlanningUnavailable(json(planningToday(Array(51).fill(action))));
  });

  it.each([
    [
      'short signing secret',
      { ...ENVIRONMENT, PLANNING_GATEWAY_CONTEXT_SECRET: 'too-short' },
    ],
    [
      'credential-bearing Identity origin',
      {
        ...ENVIRONMENT,
        IDENTITY_SERVICE_ORIGIN: 'https://user:pass@identity.example.test',
      },
    ],
    [
      'non-http Planning origin',
      { ...ENVIRONMENT, PLANNING_SERVICE_ORIGIN: 'file:///tmp/planning' },
    ],
  ])('rejects %s before dependency calls', async (_name, environment) => {
    await expectConfigurationUnavailable(environment);
  });

  it('fails closed on malformed Planning evidence', async () => {
    await expectPlanningUnavailable(
      json({ ...planningToday(), aggregateId: 'not-a-uuid' }),
    );
  });
});
