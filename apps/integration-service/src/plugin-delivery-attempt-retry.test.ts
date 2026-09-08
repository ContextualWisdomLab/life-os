import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptRetryApplication,
  PluginDeliveryAttemptRetryAuthorityError,
  type PluginDeliveryAttemptRetryStore,
} from './plugin-delivery-attempt-retry';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const CLAIM_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OCCURRED_AT = '2026-09-08T13:00:00.000Z';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('PluginDeliveryAttemptRetryApplication', () => {
  it('schedules deterministic bounded backoff and persists only the claim-token digest', async () => {
    const calls: unknown[] = [];
    const store: PluginDeliveryAttemptRetryStore = {
      recordRetryableFailure: async (command) => {
        calls.push(command);
        return {
          authorityVersion: 'life-os.plugin-delivery-attempt-retry.v1',
          deliveryId: DELIVERY_ID,
          workspaceId: WORKSPACE_ID,
          requestedByUserId: USER_ID,
          attemptNumber: 1,
          deliveryStatus: 'pending',
          occurredAt: OCCURRED_AT,
          nextAttemptAt: '2026-09-08T13:00:30.000Z',
          terminalAt: null,
          outcomeCode: 'retryable_failure',
        };
      },
    };
    const app = new PluginDeliveryAttemptRetryApplication(
      store,
      () => new Date(OCCURRED_AT),
    );

    await expect(
      app.recordRetryableFailure(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        DELIVERY_ID,
        CLAIM_TOKEN,
      ),
    ).resolves.toMatchObject({
      attemptNumber: 1,
      deliveryStatus: 'pending',
      nextAttemptAt: '2026-09-08T13:00:30.000Z',
      terminalAt: null,
      outcomeCode: 'retryable_failure',
    });
    expect(calls).toEqual([
      {
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        claimTokenDigest: digest(CLAIM_TOKEN),
        occurredAt: OCCURRED_AT,
      },
    ]);
  });

  it('fails closed when persistence rejects or no active claim is transitioned', async () => {
    for (const recordRetryableFailure of [
      async () => undefined,
      async () => {
        throw new Error('database-native-detail');
      },
    ]) {
      const app = new PluginDeliveryAttemptRetryApplication(
        { recordRetryableFailure },
        () => new Date(OCCURRED_AT),
      );
      await expect(
        app.recordRetryableFailure(
          { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
          DELIVERY_ID,
          CLAIM_TOKEN,
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryAttemptRetryAuthorityError);
    }
  });
});
