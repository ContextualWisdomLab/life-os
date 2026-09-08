import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PluginDeliveryAttemptRetryCommand } from './plugin-delivery-attempt-retry';
import {
  PluginDeliveryAttemptRetryApplication,
  PluginDeliveryAttemptRetryAuthorityError,
} from './plugin-delivery-attempt-retry';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN = '77777777-7777-4777-8777-777777777777';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('PluginDeliveryAttemptRetryApplication', () => {
  it('releases the exact active claim into deterministic bounded exponential backoff', async () => {
    const retry = vi.fn(async (command: PluginDeliveryAttemptRetryCommand) => ({
      authorityVersion: 'life-os.plugin-delivery-attempt-retry.v1' as const,
      deliveryId: command.deliveryId,
      workspaceId: command.workspaceId,
      requestedByUserId: command.requestedByUserId,
      attemptNumber: command.attemptNumber,
      outcomeCode: command.outcomeCode,
      reportedAt: command.reportedAt,
      nextAttemptAt: command.nextAttemptAt,
    }));
    const application = new PluginDeliveryAttemptRetryApplication(
      { retry },
      () => new Date('2026-09-08T12:00:00.000Z'),
    );

    await expect(
      application.retry(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        {
          deliveryId: DELIVERY_ID,
          claimToken: CLAIM_TOKEN,
          attemptNumber: 2,
          outcomeCode: 'retryable_failure',
        },
      ),
    ).resolves.toEqual({
      authorityVersion: 'life-os.plugin-delivery-attempt-retry.v1',
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      attemptNumber: 2,
      outcomeCode: 'retryable_failure',
      reportedAt: '2026-09-08T12:00:00.000Z',
      nextAttemptAt: '2026-09-08T12:01:00.000Z',
    });

    expect(retry).toHaveBeenCalledWith({
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      claimTokenDigest: digest(CLAIM_TOKEN),
      attemptNumber: 2,
      outcomeCode: 'retryable_failure',
      reportedAt: '2026-09-08T12:00:00.000Z',
      nextAttemptAt: '2026-09-08T12:01:00.000Z',
    });
  });

  it('fails closed when durable retry evidence does not bind the exact transition', async () => {
    const application = new PluginDeliveryAttemptRetryApplication(
      {
        retry: vi.fn(async (command: PluginDeliveryAttemptRetryCommand) => ({
          authorityVersion: 'life-os.plugin-delivery-attempt-retry.v1' as const,
          deliveryId: command.deliveryId,
          workspaceId: command.workspaceId,
          requestedByUserId: command.requestedByUserId,
          attemptNumber: command.attemptNumber,
          outcomeCode: command.outcomeCode,
          reportedAt: command.reportedAt,
          nextAttemptAt: '2026-09-08T12:09:59.000Z',
        })),
      },
      () => new Date('2026-09-08T12:00:00.000Z'),
    );

    await expect(
      application.retry(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        {
          deliveryId: DELIVERY_ID,
          claimToken: CLAIM_TOKEN,
          attemptNumber: 1,
          outcomeCode: 'retryable_failure',
        },
      ),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptRetryAuthorityError);
  });
});
