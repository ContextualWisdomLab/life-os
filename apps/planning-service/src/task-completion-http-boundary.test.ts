import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningService } from './planning-domain';
import { PlanningController } from './main';
import type { TaskCompletionService } from './task-completion';
import type { TodaySyncService } from './today-sync';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const COMPLETED_AT = '2026-09-10T16:00:00.000Z';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const PATH = `/v1/tasks/${TASK_ID}/completion`;
const PERCENT_ENCODED_PATH = PATH.replace('/v1/tasks/4', '/v1/tasks/%34');
const REQUEST = { method: 'PUT', originalUrl: PATH } as const;

interface CompletionServiceSpy {
  readonly setCompleted: ReturnType<typeof vi.fn>;
}

/** Signs the exact completion resource so a token cannot authorize another Planning route. */
function signedHeaders(issuedAtSeconds: number): {
  workspaceId: string;
  issuedAt: string;
  signature: string;
} {
  const issuedAt = String(issuedAtSeconds);
  const signature = createHmac('sha256', CONTEXT_SECRET)
    .update(
      `life-os.planning-context.v2\n${WORKSPACE_ID}\n${issuedAt}\nPUT\n${PATH}`,
      'utf8',
    )
    .digest('base64url');
  return { workspaceId: WORKSPACE_ID, issuedAt, signature };
}

/** Builds only the completion dependency used by this route contract. */
function createController(
  completionService: CompletionServiceSpy,
): PlanningController {
  return new PlanningController(
    {} as PlanningService,
    {} as TodaySyncService,
    completionService as unknown as TaskCompletionService,
  );
}

/** Returns a rejected HTTP status without accepting false success. */
async function rejectedStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
  throw new Error('Expected task completion HTTP request to reject');
}

afterEach(() => {
  delete process.env.PLANNING_GATEWAY_CONTEXT_SECRET;
  vi.restoreAllMocks();
});

describe.sequential('Planning task completion HTTP boundary', () => {
  it('routes a signed PUT to the durable completion service without client timestamps', async () => {
    process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const headers = signedHeaders(Math.floor(Date.now() / 1000));
    const completionService: CompletionServiceSpy = {
      setCompleted: vi.fn().mockResolvedValue({
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    };
    const controller = createController(completionService);

    await expect(
      controller.setTaskCompleted(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        TASK_ID,
        { completed: true },
        REQUEST,
      ),
    ).resolves.toEqual({
      workspaceId: WORKSPACE_ID,
      taskId: TASK_ID,
      status: 'done',
      completedAt: COMPLETED_AT,
    });
    expect(completionService.setCompleted).toHaveBeenCalledWith(
      WORKSPACE_ID,
      TASK_ID,
      true,
    );
  });

  it('routes an explicit reopen without accepting a client completion instant', async () => {
    process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const headers = signedHeaders(Math.floor(Date.now() / 1000));
    const completionService: CompletionServiceSpy = {
      setCompleted: vi.fn().mockResolvedValue({
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        status: 'todo',
        completedAt: null,
      }),
    };
    const controller = createController(completionService);

    await expect(
      controller.setTaskCompleted(
        headers.workspaceId,
        headers.issuedAt,
        headers.signature,
        TASK_ID,
        { completed: false },
        REQUEST,
      ),
    ).resolves.toMatchObject({ status: 'todo', completedAt: null });
    expect(completionService.setCompleted).toHaveBeenCalledWith(
      WORKSPACE_ID,
      TASK_ID,
      false,
    );
  });

  it('rejects a replayed route signature before the completion service is called', async () => {
    process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const headers = signedHeaders(Math.floor(Date.now() / 1000));
    const wrongPathSignature = createHmac('sha256', CONTEXT_SECRET)
      .update(
        `life-os.planning-context.v2\n${WORKSPACE_ID}\n${headers.issuedAt}\nGET\n/v1/goals`,
        'utf8',
      )
      .digest('base64url');
    const completionService: CompletionServiceSpy = { setCompleted: vi.fn() };
    const controller = createController(completionService);

    expect(
      await rejectedStatus(
        controller.setTaskCompleted(
          headers.workspaceId,
          headers.issuedAt,
          wrongPathSignature,
          TASK_ID,
          { completed: true },
          REQUEST,
        ),
      ),
    ).toBe(401);
    expect(completionService.setCompleted).not.toHaveBeenCalled();
  });

  it('rejects a percent-encoded raw path alias before completion authority is consumed', async () => {
    process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const headers = signedHeaders(Math.floor(Date.now() / 1000));
    const completionService: CompletionServiceSpy = {
      setCompleted: vi.fn().mockResolvedValue({
        workspaceId: WORKSPACE_ID,
        taskId: TASK_ID,
        status: 'done',
        completedAt: COMPLETED_AT,
      }),
    };
    const controller = createController(completionService);

    const operation = Reflect.apply(controller.setTaskCompleted, controller, [
      headers.workspaceId,
      headers.issuedAt,
      headers.signature,
      TASK_ID,
      { completed: true },
      { method: 'PUT', originalUrl: PERCENT_ENCODED_PATH },
    ]) as Promise<unknown>;

    expect(await rejectedStatus(operation)).toBe(401);
    expect(completionService.setCompleted).not.toHaveBeenCalled();
  });

  it('rejects an accessor-trapping body as an invalid command', async () => {
    process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const headers = signedHeaders(Math.floor(Date.now() / 1000));
    const completionService: CompletionServiceSpy = { setCompleted: vi.fn() };
    const { proxy, revoke } = Proxy.revocable({ completed: true }, {});
    revoke();
    const controller = createController(completionService);

    expect(
      await rejectedStatus(
        controller.setTaskCompleted(
          headers.workspaceId,
          headers.issuedAt,
          headers.signature,
          TASK_ID,
          proxy,
          REQUEST,
        ),
      ),
    ).toBe(400);
    expect(completionService.setCompleted).not.toHaveBeenCalled();
  });

  it('bounds a revoked dependency rejection to the credential-free persistence response', async () => {
    process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
    const headers = signedHeaders(Math.floor(Date.now() / 1000));
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    const completionService: CompletionServiceSpy = {
      setCompleted: vi.fn().mockRejectedValue(proxy),
    };
    const controller = createController(completionService);

    expect(
      await rejectedStatus(
        controller.setTaskCompleted(
          headers.workspaceId,
          headers.issuedAt,
          headers.signature,
          TASK_ID,
          { completed: true },
          REQUEST,
        ),
      ),
    ).toBe(503);
  });

  it.each([
    undefined,
    null,
    {},
    { completed: 'true' },
    { completed: 1 },
    { completed: null },
    [],
    { completed: true, completedAt: COMPLETED_AT },
  ])(
    'rejects malformed command bodies before persistence: %j',
    async (body) => {
      process.env.PLANNING_GATEWAY_CONTEXT_SECRET = CONTEXT_SECRET;
      const headers = signedHeaders(Math.floor(Date.now() / 1000));
      const completionService: CompletionServiceSpy = { setCompleted: vi.fn() };
      const controller = createController(completionService);

      expect(
        await rejectedStatus(
          controller.setTaskCompleted(
            headers.workspaceId,
            headers.issuedAt,
            headers.signature,
            TASK_ID,
            body,
            REQUEST,
          ),
        ),
      ).toBe(400);
      expect(completionService.setCompleted).not.toHaveBeenCalled();
    },
  );
});
