import { createHmac, randomBytes } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION } from './planning-data-rights';
import {
  parseTrustedPlanningDataRightsRequest,
  toPlanningDataRightsHttpException,
} from './planning-data-rights-http-boundary';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const SECRET = randomBytes(32).toString('base64url');
const NOW_SECONDS = 1_786_334_400;
const CONTRIBUTOR_PATH = '/v1/internal/data-rights/contributor';

const exportRequest = Object.freeze({
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  operation: 'export' as const,
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
});

/** Signs one exact Planning contributor request using the production canonical input order. */
function signature(
  request: Record<string, unknown>,
  issuedAt: string,
  path = CONTRIBUTOR_PATH,
): string {
  const idempotencyKey =
    request.operation === 'erase' ? String(request.idempotencyKey) : '-';
  return createHmac('sha256', SECRET)
    .update(
      [
        'life-os.planning-data-rights-context.v1',
        String(request.contractVersion),
        String(request.workspaceId),
        String(request.requestedByUserId),
        String(request.requestId),
        String(request.operation),
        idempotencyKey,
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
  throw new Error('Expected Planning data-rights transport to reject');
}

describe('Planning data-rights HTTP authority', () => {
  it('accepts a fresh request bound to tenant, actor, purpose, method, and path', async () => {
    const issuedAt = String(NOW_SECONDS);
    await expect(
      parseTrustedPlanningDataRightsRequest(
        exportRequest,
        { issuedAt, signature: signature(exportRequest, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    ).resolves.toEqual(exportRequest);
  });

  it.each([NOW_SECONDS - 60, NOW_SECONDS + 5])(
    'accepts authority at the exact lifetime boundary %s',
    async (issuedAtSeconds) => {
      const issuedAt = String(issuedAtSeconds);
      await expect(
        parseTrustedPlanningDataRightsRequest(
          exportRequest,
          { issuedAt, signature: signature(exportRequest, issuedAt) },
          SECRET,
          { method: 'POST', path: CONTRIBUTOR_PATH },
          NOW_SECONDS,
        ),
      ).resolves.toEqual(exportRequest);
    },
  );

  it('accepts destructive idempotency only when the signed key matches the request', async () => {
    const request = Object.freeze({
      ...exportRequest,
      operation: 'erase' as const,
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    const issuedAt = String(NOW_SECONDS);
    await expect(
      parseTrustedPlanningDataRightsRequest(
        request,
        { issuedAt, signature: signature(request, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    ).resolves.toEqual(request);

    const status = await rejectedStatus(
      parseTrustedPlanningDataRightsRequest(
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
      signed: signature(exportRequest, String(NOW_SECONDS)),
    },
    {
      name: 'wrong method',
      secret: SECRET,
      binding: { method: 'GET', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS),
      signed: signature(exportRequest, String(NOW_SECONDS)),
    },
    {
      name: 'stale evidence',
      secret: SECRET,
      binding: { method: 'POST', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS - 61),
      signed: signature(exportRequest, String(NOW_SECONDS - 61)),
    },
    {
      name: 'future evidence beyond allowed skew',
      secret: SECRET,
      binding: { method: 'POST', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS + 6),
      signed: signature(exportRequest, String(NOW_SECONDS + 6)),
    },
    {
      name: 'malformed signature length',
      secret: SECRET,
      binding: { method: 'POST', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS),
      signed: 'A'.repeat(42),
    },
    {
      name: 'malformed signature alphabet',
      secret: SECRET,
      binding: { method: 'POST', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS),
      signed: `${'A'.repeat(42)}=`,
    },
    {
      name: 'missing verifier secret',
      secret: undefined,
      binding: { method: 'POST', path: CONTRIBUTOR_PATH },
      issuedAt: String(NOW_SECONDS),
      signed: signature(exportRequest, String(NOW_SECONDS)),
    },
  ])('fails closed for $name', async ({ secret, binding, issuedAt, signed }) => {
    const status = await rejectedStatus(
      parseTrustedPlanningDataRightsRequest(
        exportRequest,
        { issuedAt, signature: signed },
        secret,
        binding,
        NOW_SECONDS,
      ),
    );
    expect(status).toBe(secret === undefined ? 503 : 401);
  });

  it('authenticates headers before revealing malformed request schema', async () => {
    const issuedAt = String(NOW_SECONDS);
    const status = await rejectedStatus(
      parseTrustedPlanningDataRightsRequest(
        [],
        { issuedAt, signature: 'A'.repeat(43) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    );
    expect(status).toBe(401);
  });

  it.each([
    [],
    { ...exportRequest, contractVersion: 'life-os.data-rights-contributor.v0' },
    { ...exportRequest, operation: 'unknown' },
    { ...exportRequest, workspaceId: 'not-a-workspace' },
    { ...exportRequest, unexpected: 'authority' },
  ])('rejects malformed request schema after valid authority format %#', async (body) => {
    const issuedAt = String(NOW_SECONDS);
    const status = await rejectedStatus(
      parseTrustedPlanningDataRightsRequest(
        body,
        { issuedAt, signature: signature(exportRequest, issuedAt) },
        SECRET,
        { method: 'POST', path: CONTRIBUTOR_PATH },
        NOW_SECONDS,
      ),
    );
    expect(status).toBe(400);
  });

  it('sanitizes contributor failures into a credential-free 503 problem', () => {
    const exception = toPlanningDataRightsHttpException(
      new Error('postgres password and internal topology'),
    );
    expect(exception.getStatus()).toBe(503);
    expect(JSON.stringify(exception.getResponse())).not.toContain('password');
  });
});