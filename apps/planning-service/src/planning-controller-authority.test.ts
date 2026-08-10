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
  readonly invoke: (
    controller: PlanningController,
    headers: RouteHeaders,
  ) => Promise<unknown>;
}

const ROUTES: readonly RouteCase[] = [
  {
    name: 'createGoal',
    serviceMethod: 'createGoal',
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

/** Produces a valid short-lived signed gateway context for the supplied issue time. */
function signedHeaders(issuedAtSeconds: number): RouteHeaders {
  const issuedAt = String(issuedAtSeconds);
  const signature = createHmac('sha256', CONTEXT_SECRET)
    .update(`life-os.workspace.v1\n${WORKSPACE_ID}\n${issuedAt}`, 'utf8')
    .digest('base64url');
  return { workspaceId: WORKSPACE_ID, issuedAt, signature };
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
    const headers = signedHeaders(nowSeconds);
    const service = createPlanningServiceSpies();
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

  it('rejects untrusted contexts before any Goal, Project, or Task service call', async () => {
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
    const service = createPlanningServiceSpies();
    const controller = createController(service);

    for (const invalid of invalidContexts) {
      for (const route of ROUTES) {
        vi.clearAllMocks();
        if (invalid.secret === false) {
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
