import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION } from './notification-data-rights';
import {
  parseTrustedNotificationDataRightsRequest,
  toNotificationDataRightsHttpException,
} from './notification-data-rights-http-boundary';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_334_400;
const CONTRIBUTOR_PATH = '/v1/internal/data-rights/contributor';
const CURSOR = Buffer.from(
  JSON.stringify({
    version: 'notification.data-rights.cursor.v1',
    evidenceTime: '2026-08-12T00:00:00.000000Z',
    evidenceKind: 'reminder_occurrence',
    evidenceId: '55555555-5555-4555-8555-555555555555',
  }),
  'utf8',
).toString('base64url');

const exportRequest = Object.freeze({
  contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
  operation: 'export' as const,
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
  cursor: CURSOR,
});

/** Signs one exact Notification contributor request using the production canonical field order. */
function signature(
  request: Record<string, unknown>,
  issuedAt: string,
  path = CONTRIBUTOR_PATH,
): string {
  const idempotencyKey =
    request.operation === 'erase' ? String(request.idempotencyKey) : '-';
  const cursor = request.operation === 'export' ? String(request.cursor ?? '-') : '-';
  return createHmac('sha256', SECRET)
    .update(
      [
        'life-os.notification-data-rights-context.v1',
        String(request.contractVersion),
        String(request.workspaceId),
        String(request.requestedByUserId),
        String(request.requestId),
        String(request.operation),
        idempotencyKey,
        cursor,
        issuedAt,
        'POST',
        path,
      ].join('\n'),
      'utf8',
    )
    .digest('base64url');
}

/** Returns the bounded HTTP status from one rejected trusted-boundary call. */
async function rejectedStatus(operation: Promise<unknown>): Promise<number> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    return (error as HttpException).getStatus();
  }
  throw new Error('Expected Notification data-rights transport to reject');
}

describe('Notification data-rights HTTP authority', () => {
  it('accepts a fresh export bound to tenant, actor, cursor, method, and path', async () => {
    const issuedAt = String(NOW_SECONDS);
    await expect(
      parseTrustedNotificationDataRightsRequest(
        exportRequest,
        { issuedAt, signature: signature(exportRequest, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    ).resolves.toEqual(exportRequest);
  });

  it('fails closed if an export cursor changes after Identity signs the request', async () => {
    const issuedAt = String(NOW_SECONDS);
    const status = await rejectedStatus(
      parseTrustedNotificationDataRightsRequest(
        { ...exportRequest, cursor: `${CURSOR}A` },
        { issuedAt, signature: signature(exportRequest, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    );
    expect(status).toBe(401);
  });

  it('fails closed if caller-selected workspace authority changes after signing', async () => {
    const issuedAt = String(NOW_SECONDS);
    const status = await rejectedStatus(
      parseTrustedNotificationDataRightsRequest(
        {
          ...exportRequest,
          workspaceId: '66666666-6666-4666-8666-666666666666',
        },
        { issuedAt, signature: signature(exportRequest, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    );
    expect(status).toBe(401);
  });

  it('accepts destructive idempotency only when the signed key matches the request', async () => {
    const request = Object.freeze({
      contractVersion: NOTIFICATION_DATA_RIGHTS_CONTRACT_VERSION,
      operation: 'erase' as const,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    const issuedAt = String(NOW_SECONDS);
    await expect(
      parseTrustedNotificationDataRightsRequest(
        request,
        { issuedAt, signature: signature(request, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    ).resolves.toEqual(request);

    const status = await rejectedStatus(
      parseTrustedNotificationDataRightsRequest(
        { ...request, idempotencyKey: REQUEST_ID },
        { issuedAt, signature: signature(request, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    );
    expect(status).toBe(401);
  });

  it.each([
    {
      name: 'wrong path',
      secret: SECRET,
      binding: { method: 'POST', path: '/v1/internal/data-rights/other' },
      issuedAt: String(NOW_SECONDS),
    },
    {
      name: 'wrong method',
      secret: SECRET,
      binding: { method: 'GET', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS),
    },
    {
      name: 'stale evidence',
      secret: SECRET,
      binding: { method: 'POST', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS - 61),
    },
    {
      name: 'missing verifier secret',
      secret: undefined,
      binding: { method: 'POST', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS),
    },
  ])('fails closed for $name', async ({ secret, binding, issuedAt }) => {
    const status = await rejectedStatus(
      parseTrustedNotificationDataRightsRequest(
        exportRequest,
        { issuedAt, signature: signature(exportRequest, issuedAt) },
        secret,
        binding,
        NOW_SECONDS,
      ),
    );
    expect(status).toBe(secret === undefined ? 503 : 401);
  });

  it('rejects undeclared request fields before contributor code can observe them', async () => {
    const issuedAt = String(NOW_SECONDS);
    const request = { ...exportRequest, unexpected: 'authority' };
    const status = await rejectedStatus(
      parseTrustedNotificationDataRightsRequest(
        request,
        { issuedAt, signature: signature(request, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    );
    expect(status).toBe(400);
  });

  it('sanitizes contributor failures into a credential-free 503 problem', () => {
    const exception = toNotificationDataRightsHttpException(
      new Error('postgres password and internal topology'),
    );
    expect(exception.getStatus()).toBe(503);
    expect(JSON.stringify(exception.getResponse())).not.toContain('password');
  });
});
