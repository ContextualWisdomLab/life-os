import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
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

function expectHttpStatus(operation: () => unknown, status: number): void {
  let thrown: unknown;
  try {
    operation();
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
  it('accepts an exact short-lived service-authenticated export request', () => {
    const issuedAt = String(NOW_SECONDS);
    expect(
      parseTrustedHabitDataRightsRequest(
        EXPORT_REQUEST,
        { issuedAt, signature: sign(EXPORT_REQUEST, BINDING, issuedAt) },
        CONTEXT_SECRET,
        BINDING,
        NOW_SECONDS,
      ),
    ).toEqual(EXPORT_REQUEST);
  });

  it('rejects replay of an export signature onto an erase request', () => {
    const eraseRequest = {
      ...EXPORT_REQUEST,
      operation: 'erase',
      idempotencyKey: IDEMPOTENCY_KEY,
    } as const;
    const issuedAt = String(NOW_SECONDS);

    expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          eraseRequest,
          { issuedAt, signature: sign(EXPORT_REQUEST, BINDING, issuedAt) },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
        ),
      401,
    );
  });

  it('binds destructive authority to the exact idempotency key', () => {
    const eraseRequest = {
      ...EXPORT_REQUEST,
      operation: 'erase',
      idempotencyKey: IDEMPOTENCY_KEY,
    } as const;
    const tamperedRequest = {
      ...eraseRequest,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    } as const;
    const issuedAt = String(NOW_SECONDS);

    expectHttpStatus(
      () =>
        parseTrustedHabitDataRightsRequest(
          tamperedRequest,
          { issuedAt, signature: sign(eraseRequest, BINDING, issuedAt) },
          CONTEXT_SECRET,
          BINDING,
          NOW_SECONDS,
        ),
      401,
    );
  });

  it('rejects a valid signature replayed to another method or path', () => {
    const issuedAt = String(NOW_SECONDS);
    const signature = sign(EXPORT_REQUEST, BINDING, issuedAt);

    for (const binding of [
      { method: 'GET', path: BINDING.path },
      { method: 'POST', path: '/v1/internal/data-rights/other' },
    ]) {
      expectHttpStatus(
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

  it('rejects stale authority, malformed UUIDs, extra fields, and missing secrets', () => {
    const issuedAt = String(NOW_SECONDS);
    const signature = sign(EXPORT_REQUEST, BINDING, issuedAt);

    expectHttpStatus(
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
    expectHttpStatus(
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
    expectHttpStatus(
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
    expectHttpStatus(
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
