import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningService } from './planning-domain';
import { PlanningController } from './main';
import type { TodaySyncService } from './today-sync';

const CONTROLLER_SOURCE = readFileSync(join(__dirname, 'main.ts'), 'utf8');

const LEGACY_WORKSPACE_HEADER = /@Headers\(['"]x-workspace-id['"]\)/gu;
const TRUSTED_WORKSPACE_HEADER =
  /@Headers\(['"]x-life-os-workspace-id['"]\)/gu;
const TRUSTED_ISSUED_AT_HEADER =
  /@Headers\(['"]x-life-os-context-issued-at['"]\)/gu;
const TRUSTED_SIGNATURE_HEADER =
  /@Headers\(['"]x-life-os-context-signature['"]\)/gu;
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const GOAL_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');

interface RouteHeaders {
  readonly workspaceId: string | undefined;
  readonly issuedAt: string | undefined;
  readonly signature: string | undefined;
}

interface RouteBinding {
  readonly method: 'GET' | 'POST';
  readonly path: string;
}

interface PlanningServiceSpies {
  readonly createGoal: ReturnType<typeof vi.fn>;
  readonly listGoals: ReturnType<typeof vi.fn>;
  readonly createProject: ReturnType<typeof vi.fn>;
  readonly listProjects: ReturnType<typeof vi.fn>;
  readonly createTask: ReturnType<typeof vi.fn>;
  readonly listTasks: ReturnType<typeof vi.fn>;
}

interface RouteCase {
  readonly name: string;
  readonly serviceMethod: keyof PlanningServiceSpies;
  readonly binding: RouteBinding;
  readonly invoke: (
    controller: PlanningController,
    headers: RouteHeaders,
  ) => Promise<unknown>;
}

const ROUTES: readonly RouteCase[] = [
  {
    name: 'createGoal',
    serviceMethod: 'createGoal',
    binding: { method: 'POST', path: '/v1/goals' },
    invoke: (controller, headers) =>
      controller.createGoal(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        { title: 'Goal' },
      ),
  },
  {
    name: 'listGoals',
    serviceMethod: 'listGoals',
    binding: { method: 'GET', path: '/v1/goals' },
    invoke: (controller, headers) =>
      controller.listGoals(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
      ),
  },
  {
    name: 'createProject',
    serviceMethod: 'createProject',
    binding: { method: 'POST', path: `/v1/goals/${GOAL_ID}/projects` },
    invoke: (controller, headers) =>
      controller.createProject(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        GOAL_ID,
        { title: 'Project' },
      ),
  },
  {
    name: 'listProjects',
    serviceMethod: 'listProjects',
    binding: { method: 'GET', path: `/v1/goals/${GOAL_ID}/projects` },
    invoke: (controller, headers) =>
      controller.listProjects(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        GOAL_ID,
      ),
  },
  {
    name: 'createTask',
    serviceMethod: 'createTask',
    binding: { method: 'POST', path: `/v1/projects/${PROJECT_ID}/tasks` },
    invoke: (controller, headers) =>
      controller.createTask(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        PROJECT_ID,
        { title: 'Task' },
      ),
  },
  {
    name: 'listTasks',
    serviceMethod: 'listTasks',
    binding: { method: 'GET', path: `/v1/projects/${PROJECT_ID}/tasks` },
    invoke: (controller, headers) =>
      controller.listTasks(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        PROJECT_ID,
      ),
  },
];

/** Counts stable route-boundary tokens in the Planning controller source. */
function count(pattern: RegExp): number {
  return [...CONTROLLER_SOURCE.matchAll(pattern)].length;
}

/** Creates the six domain-service spies exercised by workspace-scoped routes. */
function createPlanningServiceSpies(): PlanningServiceSpies {
  return {
    createGoal: vi.fn(),
    listGoals: vi.fn(),
    createProject: vi.fn(),
    listProjects: vi.fn(),
    createTask: vi.fn(),
    listTasks: vi.fn(),
  };
}

/** Creates a controller with no durable Today dependency because these routes do not use it. */
function createController(service: PlanningServiceSpies): PlanningController {
  return new PlanningController(
    service as unknown as PlanningService,
    {} as TodaySyncService,
  );
}

/** Produces a valid short-lived request-bound gateway context. */
function signedHeaders(
  issuedAtSeconds: number,
  binding: RouteBinding,
): RouteHeaders {
  const issuedAt = String(issuedAtSeconds);
  const signature = createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.planning-context.v2\n${WORKSPACE_ID}\n${issuedAt}\n${binding.method}\n${binding.path}`,
      'utf8',
    )
    .digest('base64url');
  return { workspaceId: WORKSPACE_ID, issuedAt, signature };
}

/** Corrupts an otherwise valid request-bound context without changing its shape. */
function tamperedHeaders(
  issuedAtSeconds: number,
  binding: RouteBinding,
): RouteHeaders {
  const fresh = signedHeaders(issuedAtSeconds, binding);
  const digest = Buffer.from(fresh.signature ?? '', 'base64url');
  const firstByte = digest.at(0);
  if (firstByte === undefined) {
    throw new Error('Expected a SHA-256 gateway signature');
  }
  digest[0] = firstByte ^ 0xff;
  return { ...fresh, signature: digest.toString('base64url') };
}

/** Captures the status of an expected HTTP rejection without hiding false success. */
async function rejectedStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
  throw new Error('Expected Planning route to reject untrusted workspace context');
}

afterEach(() => {
  delete process.env.PLANNING_GATEWAY_CONTEXT_SECRET;
  vi.restoreAllMocks();
});

describe.sequential('PlanningController workspace authority contract', () => {
  it('never accepts a bare client-selected workspace header', () => {
    expect(count(LEGACY_WORKSPACE_HEADER)).toBe(0);
    expect(CONTROLLER_SOURCE).not.toContain('function requireWorkspaceId');
  });

  it('binds every workspace-scoped planning route to the signed workspace context', () => {
    // search + Today GET/PUT + six Goal/Project/Task routes.
    expect(count(TRUSTED_WORKSPACE_HEADER)).toBe(9);
    expect(count(TRUSTED_ISSUED_AT_HEADER)).toBe(9);
    expect(count(TRUSTED_SIGNATURE_HEADER)).toBe(9);
    expect(CONTROLLER_SOURCE.match(/requireTrustedWorkspaceContext\(/gu)).toHaveLength(9);
  });

  it('passes the verified workspace to every Goal, Project, and Task service route', async () => {
    process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const service = createPlanningServiceSpies();
    const controller = createController(service);

    for (const route of ROUTES) {
      vi.clearAllMocks();
      const headers = signedHeaders(nowSeconds, route.binding);
      await route.invoke(controller, headers);
      expect(service[route.serviceMethod], route.name).toHaveBeenCalledTimes(1);
      expect(service[route.serviceMethod].mock.calls[0]?.[0], route.name).toBe(
        WORKSPACE_ID,
      );
    }
  });

  it('rejects untrusted contexts before any Goal, Project, or Task service call', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const service = createPlanningServiceSpies();
    const controller = createController(service);

    for (const route of ROUTES) {
      const fresh = signedHeaders(nowSeconds, route.binding);
      const invalidContexts = [
        {
          name: 'missing',
          headers: { ...fresh, workspaceId: undefined },
          status: 401,
        },
        {
          name: 'expired',
          headers: signedHeaders(nowSeconds - 120, route.binding),
          status: 401,
        },
        {
          name: 'future',
          headers: signedHeaders(nowSeconds + 120, route.binding),
          status: 401,
        },
        {
          name: 'tampered',
          headers: tamperedHeaders(nowSeconds, route.binding),
          status: 401,
        },
        {
          name: 'malformed',
          headers: { ...fresh, workspaceId: 'not-a-uuid' },
          status: 401,
        },
        {
          name: 'secret-unconfigured',
          headers: fresh,
          status: 503,
          secret: false,
        },
      ] as const;

      for (const invalid of invalidContexts) {
        vi.clearAllMocks();
        if ('secret' in invalid && invalid.secret === false) {
          delete process.env.PLANNING_GATEWAY_CONTEXT_SECRET;
        } else {
          process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
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
