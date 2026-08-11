import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HabitRuntime } from './habit-runtime';
import { HabitDataRightsController } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const REQUEST = {
  contractVersion: 'life-os.data-rights-contributor.v1',
  operation: 'export',
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
} as const;

function signature(issuedAt: string): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      [
        'life-os.habit-data-rights-context.v1',
        REQUEST.contractVersion,
        REQUEST.workspaceId,
        REQUEST.requestedByUserId,
        REQUEST.requestId,
        REQUEST.operation,
        '-',
        issuedAt,
        'POST',
        '/v1/internal/data-rights/contributor',
      ].join('\n'),
      'utf8',
    )
    .digest('base64url');
}

function controllerWith(handle: ReturnType<typeof vi.fn>): HabitDataRightsController {
  return new HabitDataRightsController({
    dataRightsContributor: { handle },
  } as unknown as HabitRuntime);
}

async function rejectedStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
  throw new Error('Expected Habit data-rights transport rejection');
}

afterEach(() => {
  delete process.env.HABIT_DATA_RIGHTS_CONTEXT_SECRET;
  vi.restoreAllMocks();
});

describe.sequential('HabitDataRightsController authority contract', () => {
  it('passes only a verified exact request to the service-owned contributor', async () => {
    process.env.HABIT_DATA_RIGHTS_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const response = {
      contractVersion: REQUEST.contractVersion,
      operation: 'export',
      contributor: 'habit.service',
      requestId: REQUEST_ID,
      schemaVersion: 'habit.data-rights.v1',
      recordCount: 0,
      sha256: '0'.repeat(64),
      data: { habits: [], completionEvents: [] },
    } as const;
    const handle = vi.fn().mockResolvedValue(response);
    const controller = controllerWith(handle);

    await expect(
      controller.contribute(issuedAt, signature(issuedAt), REQUEST),
    ).resolves.toEqual(response);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle).toHaveBeenCalledWith(REQUEST);
  });

  it('fails closed before persistence when the service signature is forged', async () => {
    process.env.HABIT_DATA_RIGHTS_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const handle = vi.fn();
    const controller = controllerWith(handle);

    expect(
      await rejectedStatus(
        controller.contribute(
          issuedAt,
          randomBytes(32).toString('base64url'),
          REQUEST,
        ),
      ),
    ).toBe(401);
    expect(handle).not.toHaveBeenCalled();
  });

  it('fails closed when the dedicated data-rights trust secret is absent', async () => {
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const handle = vi.fn();
    const controller = controllerWith(handle);

    expect(
      await rejectedStatus(
        controller.contribute(issuedAt, signature(issuedAt), REQUEST),
      ),
    ).toBe(503);
    expect(handle).not.toHaveBeenCalled();
  });
});
