import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HabitService } from './habit-domain';
import { HabitController } from './main';

const CONTROLLER_SOURCE = readFileSync(join(__dirname, 'main.ts'), 'utf8');
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const HABIT_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');

interface RouteHeaders {
  readonly workspaceId: string | undefined;
  readonly issuedAt: string | undefined;
  readonly signature: string | undefined;
}

interface HabitServiceSpies {
  readonly createHabit: ReturnType<typeof vi.fn>;
  readonly listHabits: ReturnType<typeof vi.fn>;
  readonly listOccurrences: ReturnType<typeof vi.fn>;
  readonly completeHabit: ReturnType<typeof vi.fn>;
  readonly listCompletionHistory: ReturnType<typeof vi.fn>;
}

interface RouteCase {
  readonly name: string;
  readonly serviceMethod: keyof HabitServiceSpies;
  readonly invoke: (
    controller: HabitController,
    headers: RouteHeaders,
  ) => Promise<unknown>;
}

const ROUTES: readonly RouteCase[] = [
  {
    name: 'createHabit',
    serviceMethod: 'createHabit',
    invoke: (controller, headers) =>
      controller.createHabit(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        {
          title: 'Morning walk',
          timezone: 'UTC',
          startsOn: '2026-08-10',
          recurrence: { kind: 'daily', interval: 1 },
        },
      ),
  },
  {
    name: 'listHabits',
    serviceMethod: 'listHabits',
    invoke: (controller, headers) =>
      controller.listHabits(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
      ),
  },
  {
    name: 'listOccurrences',
    serviceMethod: 'listOccurrences',
    invoke: (controller, headers) =>
      controller.listOccurrences(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        HABIT_ID,
        '2026-08-10',
        '2026-08-11',
      ),
  },
  {
    name: 'completeHabit',
    serviceMethod: 'completeHabit',
    invoke: (controller, headers) =>
      controller.completeHabit(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        HABIT_ID,
        {
          scheduledLocalDate: '2026-08-10',
          completedAt: '2026-08-10T08:00:00Z',
          idempotencyKey: IDEMPOTENCY_KEY,
        },
      ),
  },
  {
    name: 'listCompletionHistory',
    serviceMethod: 'listCompletionHistory',
    invoke: (controller, headers) =>
      controller.listCompletionHistory(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        HABIT_ID,
      ),
  },
];

/** Counts stable route-authority tokens in the Habit controller source. */
function count(pattern: RegExp): number {
  return [...CONTROLLER_SOURCE.matchAll(pattern)].length;
}

/** Creates the Habit domain-service spies used by controller authority tests. */
function createHabitServiceSpies(): HabitServiceSpies {
  return {
    createHabit: vi.fn(),
    listHabits: vi.fn(),
    listOccurrences: vi.fn(),
    completeHabit: vi.fn(),
    listCompletionHistory: vi.fn(),
  };
}

/** Creates a controller whose domain calls are observable without persistence. */
function createController(service: HabitServiceSpies): HabitController {
  return new HabitController(service as unknown as HabitService);
}

/** Produces one valid short-lived signed gateway context for an issue time. */
function signedHeaders(issuedAtSeconds: number): RouteHeaders {
  const issuedAt = String(issuedAtSeconds);
  const signature = createHmac('sha256', CONTEXT_SECRET)
    .update(`life-os.workspace.v1\n${WORKSPACE_ID}\n${issuedAt}`, 'utf8')
    .digest('base64url');
  return { workspaceId: WORKSPACE_ID, issuedAt, signature };
}

/** Returns the status of an expected bounded HTTP rejection. */
async function rejectedStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
  throw new Error('Expected Habit route to reject untrusted workspace context');
}

afterEach(() => {
  delete process.env.HABIT_GATEWAY_CONTEXT_SECRET;
  vi.restoreAllMocks();
});

describe.sequential('HabitController workspace authority contract', () => {
  it('never binds a bare client-selected workspace header', () => {
    expect(count(/@Headers\(['"]x-workspace-id['"]\)/gu)).toBe(0);
    expect(CONTROLLER_SOURCE).not.toContain('requireWorkspaceId(');
  });

  it('binds all five workspace-scoped routes to signed context verification', () => {
    expect(count(/@Headers\(['"]x-life-os-workspace-id['"]\)/gu)).toBe(5);
    expect(count(/@Headers\(['"]x-life-os-context-issued-at['"]\)/gu)).toBe(5);
    expect(count(/@Headers\(['"]x-life-os-context-signature['"]\)/gu)).toBe(5);
    expect(CONTROLLER_SOURCE.match(/requireTrustedWorkspaceContext\(/gu)).toHaveLength(5);
  });

  it('passes the verified workspace to every Habit domain route', async () => {
    process.env.HABIT_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const headers = signedHeaders(Math.floor(Date.now() / 1000));
    const service = createHabitServiceSpies();
    const controller = createController(service);

    for (const route of ROUTES) {
      vi.clearAllMocks();
      await route.invoke(controller, headers);
      expect(service[route.serviceMethod], route.name).toHaveBeenCalledTimes(1);
      expect(service[route.serviceMethod].mock.calls[0]?.[0], route.name).toBe(
        WORKSPACE_ID,
      );
    }
  });

  it('rejects untrusted contexts before every Habit domain call', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fresh = signedHeaders(nowSeconds);
    const expired = signedHeaders(nowSeconds - 120);
    const future = signedHeaders(nowSeconds + 120);
    const tampered = {
      ...fresh,
      signature: `${fresh.signature?.slice(0, -1)}${
        fresh.signature?.endsWith('A') ? 'B' : 'A'
      }`,
    };
    const malformed = { ...fresh, workspaceId: 'not-a-uuid' };
    const invalidContexts = [
      { name: 'missing', headers: { ...fresh, workspaceId: undefined }, status: 401 },
      { name: 'expired', headers: expired, status: 401 },
      { name: 'future', headers: future, status: 401 },
      { name: 'tampered', headers: tampered, status: 401 },
      { name: 'malformed', headers: malformed, status: 401 },
      { name: 'secret-unconfigured', headers: fresh, status: 503, secret: false },
    ] as const;
    const service = createHabitServiceSpies();
    const controller = createController(service);

    for (const invalid of invalidContexts) {
      for (const route of ROUTES) {
        vi.clearAllMocks();
        if ('secret' in invalid && invalid.secret === false) {
          delete process.env.HABIT_GATEWAY_CONTEXT_SECRET;
        } else {
          process.env.HABIT_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
        }
        expect(
          await rejectedStatus(route.invoke(controller, invalid.headers)),
          `${route.name}:${invalid.name}`,
        ).toBe(invalid.status);
        expect(
          service[route.serviceMethod],
          `${route.name}:${invalid.name}`,
        ).not.toHaveBeenCalled();
      }
    }
  });
});
