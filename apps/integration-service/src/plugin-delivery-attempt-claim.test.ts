import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptClaimApplication,
  PluginDeliveryAttemptClaimAuthorityError,
  type PluginDeliveryAttemptClaimStore,
} from './plugin-delivery-attempt-claim';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const CLAIM_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLAIMED_AT = '2026-09-08T10:30:00.000Z';
const LEASE_EXPIRES_AT = '2026-09-08T10:31:00.000Z';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('PluginDeliveryAttemptClaimApplication', () => {
  it('returns one opaque token while persisting only its digest and an exact finite lease', async () => {
    const calls: unknown[] = [];
    const store: PluginDeliveryAttemptClaimStore = {
      claimDue: async (input) => {
        calls.push(input);
        return {
          authorityVersion: 'life-os.plugin-delivery-attempt-claim.v1',
          deliveryId: DELIVERY_ID,
          workspaceId: WORKSPACE_ID,
          requestedByUserId: USER_ID,
          attemptNumber: 1,
          claimedAt: CLAIMED_AT,
          leaseExpiresAt: LEASE_EXPIRES_AT,
        };
      },
    };
    const app = new PluginDeliveryAttemptClaimApplication(
      store,
      () => new Date(CLAIMED_AT),
      () => CLAIM_TOKEN,
    );

    await expect(
      app.claim(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        DELIVERY_ID,
        60,
      ),
    ).resolves.toEqual({
      authorityVersion: 'life-os.plugin-delivery-attempt-claim.v1',
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      attemptNumber: 1,
      claimToken: CLAIM_TOKEN,
      claimedAt: CLAIMED_AT,
      leaseExpiresAt: LEASE_EXPIRES_AT,
    });
    expect(calls).toEqual([
      {
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        claimTokenDigest: digest(CLAIM_TOKEN),
        claimedAt: CLAIMED_AT,
        leaseExpiresAt: LEASE_EXPIRES_AT,
      },
    ]);
  });

  it('fails closed when no due unleased attempt is acquired or persistence rejects', async () => {
    for (const claimDue of [
      async () => undefined,
      async () => {
        throw new Error('database-native-detail');
      },
    ]) {
      const app = new PluginDeliveryAttemptClaimApplication(
        { claimDue },
        () => new Date(CLAIMED_AT),
        () => CLAIM_TOKEN,
      );
      await expect(
        app.claim(
          { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
          DELIVERY_ID,
          60,
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryAttemptClaimAuthorityError);
    }
  });
});
