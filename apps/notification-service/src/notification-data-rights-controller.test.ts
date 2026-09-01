import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { NotificationDataRightsResponse } from './notification-data-rights';
import { NotificationDataRightsController } from './notification-data-rights-controller';
import type { NotificationRuntime } from './notification-runtime';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';
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

/** Signs the exact controller request contract so tests exercise production authority verification. */
function signature(issuedAt: string): string {
  return createHmac('sha256', SECRET)
    .update(
      [
        'life-os.notification-data-rights-context.v1',
        body.contractVersion,
        body.workspaceId,
        body.requestedByUserId,
        body.requestId,
        body.operation,
        '-',
        '-',
        issuedAt,
        'POST',
        PATH,
      ].join('\n'),
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
        signature(issuedAt),
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
        signature(issuedAt),
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
        signature(issuedAt),
        { method: 'POST', originalUrl: PATH },
        body,
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ status: 503 });
    expect(JSON.stringify(caught)).not.toContain('password');
  });
});
