import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composeToday } from './today-composition';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PLANNING_SECRET = randomBytes(32).toString('base64url');
const HABIT_SECRET = randomBytes(32).toString('base64url');
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

const ENVIRONMENT = {
  IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
  PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
  PLANNING_GATEWAY_CONTEXT_SECRET: PLANNING_SECRET,
  HABIT_SERVICE_ORIGIN: 'https://habit.example.test',
  HABIT_GATEWAY_CONTEXT_SECRET: HABIT_SECRET,
} as const;

describe('Gateway Habit Today composition', () => {
  it('composes validated Habit status with a separately signed service context', async () => {
    const calls: Array<{ url: string; headers: Headers }> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, headers: new Headers(init?.headers) });
      if (url.endsWith('/v1/session')) return json({ workspaceId: WORKSPACE_ID });
      if (url.includes('planning.example.test')) return json(planningToday());
      return json([
        {
          habitId: '44444444-4444-4444-8444-444444444444',
          title: 'Walk deliberately',
          scheduledLocalDate: '2026-08-10',
          completed: true,
          completionId: '55555555-5555-4555-8555-555555555555',
        },
      ]);
    };

    const result = await composeToday(
      'session=opaque',
      '2026-08-10',
      ENVIRONMENT,
      fetcher,
      NOW_SECONDS,
    );

    expect(result.habits).toEqual([
      {
        habitId: '44444444-4444-4444-8444-444444444444',
        title: 'Walk deliberately',
        scheduledLocalDate: '2026-08-10',
        completed: true,
        completionId: '55555555-5555-4555-8555-555555555555',
      },
    ]);
    expect(result.degraded).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(calls[2]?.url).toBe(
      'https://habit.example.test/v1/habits/today?date=2026-08-10',
    );
    expect(calls[2]?.headers.get('cookie')).toBeNull();
    expect(calls[2]?.headers.get('x-life-os-workspace-id')).toBe(WORKSPACE_ID);
    expect(calls[2]?.headers.get('x-life-os-context-signature')).toBe(
      createHmac('sha256', HABIT_SECRET)
        .update(
          `life-os.workspace.v1\n${WORKSPACE_ID}\n${NOW_SECONDS}`,
          'utf8',
        )
        .digest('base64url'),
    );
  });

  it('returns explicit partial degradation when Habit is not configured', async () => {
    const fetcher = async (input: RequestInfo | URL) =>
      String(input).endsWith('/v1/session')
        ? json({ workspaceId: WORKSPACE_ID })
        : json(planningToday());

    const result = await composeToday(
      'session=opaque',
      '2026-08-10',
      {
        IDENTITY_SERVICE_ORIGIN: ENVIRONMENT.IDENTITY_SERVICE_ORIGIN,
        PLANNING_SERVICE_ORIGIN: ENVIRONMENT.PLANNING_SERVICE_ORIGIN,
        PLANNING_GATEWAY_CONTEXT_SECRET:
          ENVIRONMENT.PLANNING_GATEWAY_CONTEXT_SECRET,
      },
      fetcher,
      NOW_SECONDS,
    );

    expect(result.habits).toEqual([]);
    expect(result.degraded).toEqual(['habits_not_configured']);
  });

  it('returns explicit partial degradation when Habit is unavailable', async () => {
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/v1/session')) return json({ workspaceId: WORKSPACE_ID });
      if (url.includes('planning.example.test')) return json(planningToday());
      return json({ code: 'service_unavailable' }, 503);
    };

    const result = await composeToday(
      'session=opaque',
      '2026-08-10',
      ENVIRONMENT,
      fetcher,
      NOW_SECONDS,
    );

    expect(result.habits).toEqual([]);
    expect(result.degraded).toEqual(['habits_unavailable']);
  });
});
