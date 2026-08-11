import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HabitRuntime } from './habit-runtime';
import { HabitDataRightsController } from './main';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const REQUEST = {
  contractVersion: 'life-os.data-rights-contributor.v1',
  operation: 'export',
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
} as const;
const ERASE_REQUEST = {
  ...REQUEST,
  operation: 'erase',
  idempotencyKey: IDEMPOTENCY_KEY,
} as const;

type SignedRequest = typeof REQUEST | typeof ERASE_REQUEST;

function signature(request: SignedRequest, issuedAt: string): string {
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      [
        'life-os.habit-data-rights-context.v1',
        request.contractVersion,
        request.workspaceId,
        request.requestedByUserId,
        request.requestId,
        request.operation,
        request.operation === 'erase' ? request.idempotencyKey : '-',
        issuedAt,
        'POST',
        '/v1/internal/data-rights/contributor',
      ].join('\n'),
      'utf8',
    )
    .digest('base64url');
}

function controllerWith(
  handle: ReturnType<typeof vi.fn>,
  consume: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(true),
): HabitDataRightsController {
  return new HabitDataRightsController({
    dataRightsContributor: { handle },
    dataRightsAuthorityReplayGuard: { consume },
  } as unknown as HabitRuntime);
}

async function rejectedException(operation: Promise<unknown>): Promise<HttpException> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return error as HttpException;
  }
  throw new Error('Expected Habit data-rights transport rejection');
}

async function rejectedStatus(operation: Promise<unknown>): Promise<number> {
  return (await rejectedException(operation)).getStatus();
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
      controller.contribute(issuedAt, signature(REQUEST, issuedAt), REQUEST),
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
        controller.contribute(issuedAt, signature(REQUEST, issuedAt), REQUEST),
      ),
    ).toBe(503);
    expect(handle).not.toHaveBeenCalled();
  });

  it('atomically rejects replay of the same destructive signed authority before contribution', async () => {
    process.env.HABIT_DATA_RIGHTS_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const consume = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const response = {
      contractVersion: ERASE_REQUEST.contractVersion,
      operation: 'erase',
      contributor: 'habit.service',
      requestId: REQUEST_ID,
      erasedRecords: 2,
      receiptSha256: '1'.repeat(64),
    } as const;
    const handle = vi.fn().mockResolvedValue(response);
    const controller = controllerWith(handle, consume);
    const signed = signature(ERASE_REQUEST, issuedAt);

    await expect(
      controller.contribute(issuedAt, signed, ERASE_REQUEST),
    ).resolves.toEqual(response);
    expect(
      await rejectedStatus(
        controller.contribute(issuedAt, signed, ERASE_REQUEST),
      ),
    ).toBe(401);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('sanitizes arbitrary contributor HttpException responses to one bounded 503 problem', async () => {
    process.env.HABIT_DATA_RIGHTS_CONTEXT_SECRET = CONTEXT_SECRET;
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const handle = vi
      .fn()
      .mockRejectedValue(new HttpException({ leaked: 'provider detail' }, 418));
    const controller = controllerWith(handle);

    const error = await rejectedException(
      controller.contribute(issuedAt, signature(REQUEST, issuedAt), REQUEST),
    );
    expect(error.getStatus()).toBe(503);
    expect(error.getResponse()).toEqual({
      type: 'about:blank',
      title: 'Habit data-rights operation is unavailable',
      status: 503,
      code: 'data_rights_unavailable',
    });
  });
});
