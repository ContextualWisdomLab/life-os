import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { NotificationDataRightsResponse } from './notification-data-rights';
import { NotificationDataRightsController } from './notification-data-rights-controller';
import type { NotificationRuntime } from './notification-runtime';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const SECRET = randomBytes(32).toString('base64url');
const PATH = '/v1/internal/data-rights/contributor';
const ORIGINAL_SECRET = process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET;

const body = Object.freeze({
  contractVersion: 'life-os.data-rights-contributor.v1',
  operation: 'verify_erased' as const,
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
});

const eraseBody = Object.freeze({
  contractVersion: 'life-os.data-rights-contributor.v1',
  operation: 'erase' as const,
  workspaceId: WORKSPACE_ID,
  requestedByUserId: USER_ID,
  requestId: REQUEST_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
});

/** Signs the exact controller request contract so tests exercise production authority verification. */
function signature(
  request: Readonly<Record<string, unknown>>,
  issuedAt: string,
): string {
  const idempotencyKey =
    request.operation === 'erase' ? String(request.idempotencyKey) : '-';
  const cursor = request.operation === 'export' ? String(request.cursor ?? '-') : '-';
  return createHmac('sha256', SECRET)
    .update(
      [
        String(request.contractVersion),
        String(request.workspaceId),
        String(request.requestedByUserId),
        String(request.requestId),
        String(request.operation),
        idempotencyKey,
        cursor,
        issuedAt,
        'POST',
        PATH,
      ]
        .toSpliced(0, 0, 'life-os.notification-data-rights-context.v1')
        .join('\n'),
      'utf8',
    )
    .digest('base64url');
}

/** Produces one minimal runtime whose contributor records the authenticated request. */
function runtime(recorded: unknown[]): NotificationRuntime {
  return {
    dataRightsContributor: {
      async handle(request: unknown): Promise<NotificationDataRightsResponse> {
        recorded.push(request);
        return {
          contractVersion: 'life-os.data-rights-contributor.v1',
          contributor: 'notification.service',
          operation: 'verify_erased',
          requestId: REQUEST_ID,
          erased: true,
          evidenceSha256: 'a'.repeat(64),
        };
      },
    },
  } as unknown as NotificationRuntime;
}

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET;
  } else {
    process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET = ORIGINAL_SECRET;
  }
});

describe('NotificationDataRightsController', () => {
  it('passes only authenticated normalized authority to the contributor', async () => {
    process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET = SECRET;
    const recorded: unknown[] = [];
    const controller = new NotificationDataRightsController(runtime(recorded));
    const issuedAt = String(Math.floor(Date.now() / 1000));

    await expect(
      controller.contribute(
        issuedAt,
        signature(body, issuedAt),
        { method: 'POST', originalUrl: PATH },
        body,
      ),
    ).resolves.toMatchObject({ operation: 'verify_erased', erased: true });
    expect(recorded).toEqual([body]);
  });

  it('uses the composition-provided secret instead of ambient process state', async () => {
    process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET = 'x'.repeat(32);
    const recorded: unknown[] = [];
    const controller = new NotificationDataRightsController(runtime(recorded), SECRET);
    const issuedAt = String(Math.floor(Date.now() / 1000));

    await expect(
      controller.contribute(
        issuedAt,
        signature(body, issuedAt),
        { method: 'POST', originalUrl: PATH },
        body,
      ),
    ).resolves.toMatchObject({ operation: 'verify_erased', erased: true });
    expect(recorded).toEqual([body]);
  });

  it('rejects a route mismatch before the contributor can observe request data', async () => {
    process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET = SECRET;
    const recorded: unknown[] = [];
    const controller = new NotificationDataRightsController(runtime(recorded));
    const issuedAt = String(Math.floor(Date.now() / 1000));

    await expect(
      controller.contribute(
        issuedAt,
        signature(body, issuedAt),
        { method: 'POST', originalUrl: '/v1/internal/data-rights/other' },
        body,
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(recorded).toEqual([]);
  });

  it('maps contributor failures without reflecting internal details', async () => {
    process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET = SECRET;
    const controller = new NotificationDataRightsController({
      dataRightsContributor: {
        async handle(): Promise<never> {
          throw new Error('postgres://user:password@internal-db');
        },
      },
    } as unknown as NotificationRuntime);
    const issuedAt = String(Math.floor(Date.now() / 1000));

    let caught: unknown;
    try {
      await controller.contribute(
        issuedAt,
        signature(body, issuedAt),
        { method: 'POST', originalUrl: PATH },
        body,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 503 });
    expect(JSON.stringify(caught)).not.toContain('password');
  });

  it('releases a claimed erase signature after a transient contributor failure so the exact retry can succeed', async () => {
    process.env.NOTIFICATION_DATA_RIGHTS_CONTEXT_SECRET = SECRET;
    let fail = true;
    const claims = new Set<string>();
    const replayGuard = {
      async consume({ evidenceDigest }: { readonly evidenceDigest: string }): Promise<boolean> {
        if (claims.has(evidenceDigest)) return false;
        claims.add(evidenceDigest);
        return true;
      },
      async release(evidenceDigest: string): Promise<void> {
        claims.delete(evidenceDigest);
      },
    };
    const controller = new NotificationDataRightsController({
      dataRightsAuthorityReplayGuard: replayGuard,
      dataRightsContributor: {
        async handle(): Promise<NotificationDataRightsResponse> {
          if (fail) {
            fail = false;
            throw new Error('temporary database failure');
          }
          return {
            contractVersion: 'life-os.data-rights-contributor.v1',
            contributor: 'notification.service',
            operation: 'erase',
            requestId: REQUEST_ID,
            erasedRecords: 1,
            receiptSha256: 'a'.repeat(64),
          };
        },
      },
    } as unknown as NotificationRuntime);
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const signed = signature(eraseBody, issuedAt);

    await expect(
      controller.contribute(
        issuedAt,
        signed,
        { method: 'POST', originalUrl: PATH },
        eraseBody,
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(claims.size).toBe(0);

    await expect(
      controller.contribute(
        issuedAt,
        signed,
        { method: 'POST', originalUrl: PATH },
        eraseBody,
      ),
    ).resolves.toMatchObject({ operation: 'erase', erasedRecords: 1 });
    expect(claims.size).toBe(1);
  });
});
