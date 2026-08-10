import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composePlanningToday } from './today-composition';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TEST_SIGNING_KEY = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_374_000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function planningToday(): Readonly<Record<string, unknown>> {
  return {
    version: 'life-os.today.v1',
    aggregateId: '22222222-2222-4222-8222-222222222222',
    revision: '33333333-3333-4333-8333-333333333333',
    date: '2026-08-10',
    actions: [],
  };
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
      {
        IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
        PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
        PLANNING_GATEWAY_CONTEXT_SECRET: TEST_SIGNING_KEY,
      },
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
        {
          IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
          PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
          PLANNING_GATEWAY_CONTEXT_SECRET: TEST_SIGNING_KEY,
        },
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({
      status: 401,
      code: 'authentication_required',
    });
    expect(calls).toEqual(['https://identity.example.test/v1/session']);
  });

  it('does not fabricate success when Planning is unavailable', async () => {
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/session')
        ? json({ workspaceId: WORKSPACE_ID })
        : json({ error: 'down' }, 503);

    await expect(
      composePlanningToday(
        'session=opaque',
        '2026-08-10',
        {
          IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
          PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
          PLANNING_GATEWAY_CONTEXT_SECRET: TEST_SIGNING_KEY,
        },
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'today_composition_unavailable',
    });
  });

  it('fails closed on malformed Planning evidence', async () => {
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/session')
        ? json({ workspaceId: WORKSPACE_ID })
        : json({ ...planningToday(), aggregateId: 'not-a-uuid' });

    await expect(
      composePlanningToday(
        'session=opaque',
        '2026-08-10',
        {
          IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
          PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
          PLANNING_GATEWAY_CONTEXT_SECRET: TEST_SIGNING_KEY,
        },
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'today_composition_unavailable',
    });
  });
});
