import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composePlanningToday, composeToday } from './today-composition';

const WORKSPACE_ID = '123e4567-e89b-42d3-a456-426614174000';
const AGGREGATE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const REVISION_ID = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
const ACTION_ID = 'deadbeef-cafe-4bad-8dad-feedfacecafe';
const HABIT_ID = 'aaaaaaaa-1111-4bbb-8ccc-dddddddddddd';
const COMPLETION_ID = 'bbbbbbbb-2222-4ccc-8ddd-eeeeeeeeeeee';
const PLANNING_SECRET = randomBytes(32).toString('base64url');
const HABIT_SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_790_000_000;
const DATE = '2026-09-21';

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function planningToday(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    version: 'life-os.today.v1',
    aggregateId: AGGREGATE_ID,
    revision: REVISION_ID,
    date: DATE,
    actions: [{ id: ACTION_ID, title: 'Retain canonical Today evidence' }],
    ...overrides,
  };
}

const ENVIRONMENT = {
  IDENTITY_SERVICE_ORIGIN: 'https://identity.example.test',
  PLANNING_SERVICE_ORIGIN: 'https://planning.example.test',
  PLANNING_GATEWAY_CONTEXT_SECRET: PLANNING_SECRET,
  HABIT_SERVICE_ORIGIN: 'https://habit.example.test',
  HABIT_GATEWAY_CONTEXT_SECRET: HABIT_SECRET,
} as const;

async function expectPlanningEvidenceRejected(
  body: Readonly<Record<string, unknown>>,
): Promise<void> {
  const fetcher = async (input: RequestInfo | URL) =>
    String(input).endsWith('/v1/session')
      ? json({ workspaceId: WORKSPACE_ID })
      : json(body);

  await expect(
    composePlanningToday(
      'session=opaque',
      DATE,
      ENVIRONMENT,
      fetcher,
      NOW_SECONDS,
    ),
  ).rejects.toMatchObject({
    status: 503,
    code: 'today_composition_unavailable',
  });
}

describe('Gateway Today canonical service evidence', () => {
  it('rejects noncanonical Identity workspace evidence before deriving downstream authority', async () => {
    let planningCalled = false;
    const fetcher = async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/v1/session')) {
        return json({ workspaceId: WORKSPACE_ID.toUpperCase() });
      }
      planningCalled = true;
      return json(planningToday());
    };

    await expect(
      composePlanningToday(
        'session=opaque',
        DATE,
        ENVIRONMENT,
        fetcher,
        NOW_SECONDS,
      ),
    ).rejects.toMatchObject({
      status: 503,
      code: 'today_composition_unavailable',
    });
    expect(planningCalled).toBe(false);
  });

  it.each([
    [
      'Planning aggregate identity',
      planningToday({ aggregateId: AGGREGATE_ID.toUpperCase() }),
    ],
    [
      'Planning revision identity',
      planningToday({ revision: REVISION_ID.toUpperCase() }),
    ],
    [
      'Planning action identity',
      planningToday({
        actions: [
          {
            id: ACTION_ID.toUpperCase(),
            title: 'Retain canonical Today evidence',
          },
        ],
      }),
    ],
  ])('rejects byte-different %s evidence', async (_name, body) => {
    await expectPlanningEvidenceRejected(body);
  });

  it.each([
    [
      'Habit identity',
      {
        habitId: HABIT_ID.toUpperCase(),
        title: 'Walk deliberately',
        scheduledLocalDate: DATE,
        completed: true,
        completionId: COMPLETION_ID,
      },
    ],
    [
      'Habit completion identity',
      {
        habitId: HABIT_ID,
        title: 'Walk deliberately',
        scheduledLocalDate: DATE,
        completed: true,
        completionId: COMPLETION_ID.toUpperCase(),
      },
    ],
  ])(
    'degrades instead of recanonicalizing %s evidence',
    async (_name, habit) => {
      const fetcher = async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/v1/session'))
          return json({ workspaceId: WORKSPACE_ID });
        if (url.includes('planning.example.test')) return json(planningToday());
        return json([habit]);
      };

      const result = await composeToday(
        'session=opaque',
        DATE,
        ENVIRONMENT,
        fetcher,
        NOW_SECONDS,
      );

      expect(result.habits).toEqual([]);
      expect(result.degraded).toEqual(['habits_unavailable']);
    },
  );
});
