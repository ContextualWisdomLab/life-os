import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composePlanningToday } from './today-composition';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = '0123456789abcdef0123456789abcdef';
const NOW = 1_786_374_000;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe('Gateway planning Today composition', () => {
  it('derives workspace from identity and sends only signed service authority to Planning', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith('/v1/session')) return json({ workspaceId: WORKSPACE_ID });
      return json({
        version: 'life-os.today.v1',
        aggregateId: '22222222-2222-4222-8222-222222222222',
        revision: '33333333-3333-4333-8333-333333333333',
        date: '2026-08-10',
        actions: [],
      });
    };

    const result = await composePlanningToday(
      'session=opaque',
      '2026-08-10',
      {
        IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
        PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
        PLANNING_GATEWAY_CONTEXT_SECRET: SECRET,
      },
      fetcher,
      NOW,
    );

    expect(result).toMatchObject({
      version: 'life-os.gateway-today.v1',
      date: '2026-08-10',
      planning: { version: 'life-os.today.v1', date: '2026-08-10' },
      degraded: ['habits_not_composed'],
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers.get('cookie')).toBe('session=opaque');
    expect(calls[1]?.headers.get('cookie')).toBeNull();
    expect(calls[1]?.headers.get('x-life-os-workspace-id')).toBe(WORKSPACE_ID);
    expect(calls[1]?.headers.get('x-life-os-context-issued-at')).toBe(String(NOW));
    expect(calls[1]?.headers.get('x-life-os-context-signature')).toBe(
      createHmac('sha256', SECRET)
        .update(`life-os.workspace.v1\n${WORKSPACE_ID}\n${NOW}`, 'utf8')
        .digest('base64url'),
    );
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
          PLANNING_GATEWAY_CONTEXT_SECRET: SECRET,
        },
        fetcher,
        NOW,
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'today_composition_unavailable',
    });
  });
});
