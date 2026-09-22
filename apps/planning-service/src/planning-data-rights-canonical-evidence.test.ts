import { createHmac } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION } from './planning-data-rights';
import { parseTrustedPlanningDataRightsRequest } from './planning-data-rights-http-boundary';

const WORKSPACE_ID = '3b237d04-e84c-4ac4-933d-7f179865e1a0';
const USER_ID = '2fa6c973-61d2-4b2f-a19e-0c8f4d672e31';
const REQUEST_ID = '6d44e8b2-9f17-45ca-b723-18ae50d9c641';
const IDEMPOTENCY_KEY = '84b3c5d6-2a71-4f8e-9c30-7d1265ab49ef';
const SECRET = Buffer.alloc(32, 0x52).toString('base64url');
const NOW_SECONDS = 1_795_000_000;
const CONTRIBUTOR_PATH = '/v1/internal/data-rights/contributor';

const exportRequest = Object.freeze({
  contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  operation: 'export' as const,
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
});

const eraseRequest = Object.freeze({
  ...exportRequest,
  operation: 'erase' as const,
  idempotencyKey: IDEMPOTENCY_KEY,
});

function signRequest(request: Record<string, unknown>): string {
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
        String(NOW_SECONDS),
        'POST',
        CONTRIBUTOR_PATH,
      ].join('\n'),
      'utf8',
    )
    .digest('base64url');
}

async function expectInvalidRequest(
  request: Record<string, unknown>,
  signature: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await parseTrustedPlanningDataRightsRequest(
      request,
      { issuedAt: String(NOW_SECONDS), signature },
      SECRET,
      { method: 'POST', path: CONTRIBUTOR_PATH },
      NOW_SECONDS,
    );
  } catch (error) {
    thrown = error;
  }
  if (thrown === undefined) {
    throw new Error(
      'Expected noncanonical signed data-rights evidence to be rejected',
    );
  }
  expect(thrown).toBeInstanceOf(HttpException);
  expect((thrown as HttpException).getStatus()).toBe(400);
  expect((thrown as HttpException).getResponse()).toEqual({
    type: 'about:blank',
    title: 'Planning data-rights request is invalid',
    status: 400,
    code: 'invalid_data_rights_request',
  });
}

describe('Planning data-rights canonical signed evidence', () => {
  it.each([
    ['workspaceId', WORKSPACE_ID],
    ['requestedByUserId', USER_ID],
    ['requestId', REQUEST_ID],
  ] as const)(
    'rejects case-changed signed %s evidence without re-signing',
    async (field, canonicalValue) => {
      const changedValue = canonicalValue.toUpperCase();
      const signature = signRequest(exportRequest);

      expect(changedValue).not.toBe(canonicalValue);
      await expectInvalidRequest(
        { ...exportRequest, [field]: changedValue },
        signature,
      );
    },
  );

  it('rejects a case-changed destructive idempotency key without re-signing', async () => {
    const changedValue = IDEMPOTENCY_KEY.toUpperCase();
    const signature = signRequest(eraseRequest);

    expect(changedValue).not.toBe(IDEMPOTENCY_KEY);
    await expectInvalidRequest(
      { ...eraseRequest, idempotencyKey: changedValue },
      signature,
    );
  });
});
