import { createHash, createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import {
  parseTrustedHabitDataRightsRequest,
  type HabitDataRightsRequestBinding,
} from './habit-data-rights-http-boundary';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const CONTEXT_SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_785_806_400;
const BINDING = {
  method: 'POST',
  path: '/v1/internal/data-rights/contributor',
} as const;

const EXPORT_REQUEST = {
  contractVersion: 'life-os.data-rights-contributor.v1',
  operation: 'export',
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
} as const;
const ERASE_REQUEST = {
  ...EXPORT_REQUEST,
  operation: 'erase',
  idempotencyKey: IDEMPOTENCY_KEY,
} as const;

function sign(
  request: Readonly<Record<string, unknown>>,
  binding: HabitDataRightsRequestBinding = BINDING,
  issuedAt = String(NOW_SECONDS),
): string {
  const operation = String(request.operation);
  const idempotencyKey =
    operation === 'erase' ? String(request.idempotencyKey) : '-';
  return createHmac('sha256', CONTEXT_SECRET)
    .update(
      [
        'life-os.habit-data-rights-context.v1',
        request.contractVersion,
        request.workspaceId,
        request.requestedByUserId,
        request.requestId,
        operation,
        idempotencyKey,
        issuedAt,
        binding.method,
        binding.path,
      ].join('\n'),
      'utf8',
    )
    .digest('base64url');
}

async function expectHttpStatus(
  operation: () => Promise<unknown>,
  status: number,
): Promise<void> {
  let thrown: unknown;
  try {
    await operation();
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) {
    throw new Error(`Expected HTTP ${status} rejection`);
  }
  expect(thrown).toBeInstanceOf(HttpException);
  expect((thrown as HttpException).getStatus()).toBe(status);
}

describe('Habit data-rights trusted HTTP boundary', () => {
  it('accepts an exact short-lived service-authenticated export request', async () => {
    const issuedAt = String(NOW_SECONDS);
    await expect(
      parseTrustedHabitDataRightsRequest(
        EXPORT_REQUEST,
        { issuedAt, signature: sign(EXPORT_REQUEST, BINDING, issuedAt) },
        CONTEXT_SECRET,
        BINDING,
        NOW_SECONDS,
      ),
    ).resolves.toEqual(EXPORT_REQUEST);
  });

  it('atomically consumes valid destructive authority and rejects an already consumed proof', async () => {
    const issuedAt = String(NOW_SECONDS - 30);
    const signature = sign(ERASE_REQUEST, BINDING, issuedAt);
    const consume = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);
    const replayGuard = { consume };

    await expect(
      parseTrustedHabitDataRightsRequest(
        ERASE_REQUEST,
        { issuedAt, signature },
        CONTEXT_SECRET,
        BINDING,
        NOW_SECONDS,
        replayGuard,
      ),
    ).resolves.toEqual(ERASE_REQUEST);
    expect(consume).toHaveBeenCalledWith({
      evidenceDigest: createHash('sha256')
        .update(signature, 'ascii')
        .digest('hex'),
      expiresAt: new Date((NOW_SECONDS + 30) * 1_000).toISOString(),
    });

    await expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          ERASE_REQUEST,
          { issuedAt, signature },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
          replayGuard,
        ),
      401,
    );
    expect(consume).toHaveBeenCalledTimes(2);
  });

  it('fails closed when destructive replay persistence is absent or unavailable', async () => {
    const issuedAt = String(NOW_SECONDS);
    const signature = sign(ERASE_REQUEST, BINDING, issuedAt);

    await expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          ERASE_REQUEST,
          { issuedAt, signature },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
        ),
      503,
    );

    let thrown: unknown;
    try {
      await parseTrustedHabitDataRightsRequest(
        ERASE_REQUEST,
        { issuedAt, signature },
        CONTEXT_SECRET,
        BINDING,
        NOW_SECONDS,
        { consume: vi.fn().mockRejectedValue(new Error('database detail')) },
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(503);
    expect(JSON.stringify((thrown as HttpException).getResponse())).not.toContain(
      'database detail',
    );
  });

  it('rejects replay of an export signature onto an erase request', async () => {
    const issuedAt = String(NOW_SECONDS);

    await expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          ERASE_REQUEST,
          { issuedAt, signature: sign(EXPORT_REQUEST, BINDING, issuedAt) },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
          { consume: vi.fn().mockResolvedValue(true) },
        ),
      401,
    );
  });

  it('binds destructive authority to the exact idempotency key', async () => {
    const tamperedRequest = {
      ...ERASE_REQUEST,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    } as const;
    const issuedAt = String(NOW_SECONDS);

    await expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          tamperedRequest,
          { issuedAt, signature: sign(ERASE_REQUEST, BINDING, issuedAt) },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
          { consume: vi.fn().mockResolvedValue(true) },
        ),
      401,
    );
  });

  it('rejects a valid signature replayed to another method or path', async () => {
    const issuedAt = String(NOW_SECONDS);
    const signature = sign(EXPORT_REQUEST, BINDING, issuedAt);

    for (const binding of [
      { method: 'GET', path: BINDING.path },
      { method: 'POST', path: '/v1/internal/data-rights/other' },
    ]) {
      await expectHttpStatus(
        () =>
          parseTrustedHabitDataRightsRequest(
            EXPORT_REQUEST,
            { issuedAt, signature },
            CONTEXT_SECRET,
            binding,
            NOW_SECONDS,
          ),
        401,
      );
    }
  });

  it('rejects stale authority, malformed UUIDs, extra fields, and missing secrets', async () => {
    const issuedAt = String(NOW_SECONDS);
    const signature = sign(EXPORT_REQUEST, BINDING, issuedAt);

    await expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          EXPORT_REQUEST,
          { issuedAt: String(NOW_SECONDS - 61), signature },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
        ),
      401,
    );
    await expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          { ...EXPORT_REQUEST, workspaceId: 'workspace-one' },
          { issuedAt, signature },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
        ),
      400,
    );
    await expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          { ...EXPORT_REQUEST, unexpected: true },
          { issuedAt, signature },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
        ),
      400,
    );
    await expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          EXPORT_REQUEST,
          { issuedAt, signature },
          undefined,
          BINDING,
          NOW_SECONDS,
        ),
      503,
    );
  });
});
