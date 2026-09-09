import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptClaimApplication,
  PluginDeliveryAttemptClaimAuthorityError,
  type PluginDeliveryAttemptClaimEvidence,
  type PluginDeliveryAttemptClaimStore,
} from './plugin-delivery-attempt-claim';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const CLAIM_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLAIMED_AT = '2026-09-08T10:30:00.000Z';
const LEASE_EXPIRES_AT = '2026-09-08T10:31:00.000Z';
const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function evidence(
  overrides: Partial<PluginDeliveryAttemptClaimEvidence> = {},
): PluginDeliveryAttemptClaimEvidence {
  return {
    authorityVersion: 'life-os.plugin-delivery-attempt-claim.v1',
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    attemptNumber: 1,
    claimedAt: CLAIMED_AT,
    leaseExpiresAt: LEASE_EXPIRES_AT,
    ...overrides,
  };
}

function fixedApplication(
  claimDue: PluginDeliveryAttemptClaimStore['claimDue'],
  now: () => Date = () => new Date(CLAIMED_AT),
  createClaimToken: () => string = () => CLAIM_TOKEN,
): PluginDeliveryAttemptClaimApplication {
  return new PluginDeliveryAttemptClaimApplication(
    { claimDue },
    now,
    createClaimToken,
  );
}

describe('PluginDeliveryAttemptClaimApplication', () => {
  it('returns one opaque token while persisting only its digest and an exact finite lease', async () => {
    const calls: unknown[] = [];
    const store: PluginDeliveryAttemptClaimStore = {
      claimDue: async (input) => {
        calls.push(input);
        return evidence();
      },
    };
    const app = fixedApplication(store.claimDue);

    await expect(app.claim(CONTEXT, DELIVERY_ID, 60)).resolves.toEqual({
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
      const app = fixedApplication(claimDue);
      await expect(app.claim(CONTEXT, DELIVERY_ID, 60)).rejects.toBeInstanceOf(
        PluginDeliveryAttemptClaimAuthorityError,
      );
    }
  });

  it('rejects malformed request authority before persistence', async () => {
    const cases: ReadonlyArray<
      readonly [unknown, unknown, unknown, () => Date, () => string]
    > = [
      [null, DELIVERY_ID, 60, () => new Date(CLAIMED_AT), () => CLAIM_TOKEN],
      [[], DELIVERY_ID, 60, () => new Date(CLAIMED_AT), () => CLAIM_TOKEN],
      [
        { workspaceId: undefined, actorUserId: USER_ID },
        DELIVERY_ID,
        60,
        () => new Date(CLAIMED_AT),
        () => CLAIM_TOKEN,
      ],
      [
        CONTEXT,
        'not-a-uuid',
        60,
        () => new Date(CLAIMED_AT),
        () => CLAIM_TOKEN,
      ],
      [
        CONTEXT,
        DELIVERY_ID,
        '60',
        () => new Date(CLAIMED_AT),
        () => CLAIM_TOKEN,
      ],
      [
        CONTEXT,
        DELIVERY_ID,
        60.5,
        () => new Date(CLAIMED_AT),
        () => CLAIM_TOKEN,
      ],
      [
        CONTEXT,
        DELIVERY_ID,
        29,
        () => new Date(CLAIMED_AT),
        () => CLAIM_TOKEN,
      ],
      [
        CONTEXT,
        DELIVERY_ID,
        3_601,
        () => new Date(CLAIMED_AT),
        () => CLAIM_TOKEN,
      ],
      [
        CONTEXT,
        DELIVERY_ID,
        60,
        () => new Date(Number.NaN),
        () => CLAIM_TOKEN,
      ],
      [
        CONTEXT,
        DELIVERY_ID,
        60,
        () => new Date(CLAIMED_AT),
        () => {
          throw new Error('entropy-native-detail');
        },
      ],
      [
        CONTEXT,
        DELIVERY_ID,
        60,
        () => new Date(CLAIMED_AT),
        () => 'not-a-uuid',
      ],
    ];

    for (const [context, deliveryId, leaseSeconds, now, createClaimToken] of cases) {
      let calls = 0;
      const app = fixedApplication(
        async () => {
          calls += 1;
          return evidence();
        },
        now,
        createClaimToken,
      );
      await expect(
        app.claim(
          context as typeof CONTEXT,
          deliveryId as string,
          leaseSeconds as number,
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryAttemptClaimAuthorityError);
      expect(calls).toBe(0);
    }
  });

  it('rejects malformed and contradictory durable claim evidence', async () => {
    const malformedInstant = 'not-an-instant';
    const normalizedInstant = '2026-02-31T10:30:00.000Z';
    const cases: unknown[] = [
      null,
      'not-an-object',
      [],
      evidence({
        authorityVersion: 'life-os.plugin-delivery-attempt-claim.v2' as never,
      }),
      evidence({ deliveryId: '66666666-6666-4666-8666-666666666666' }),
      evidence({ workspaceId: '66666666-6666-4666-8666-666666666666' }),
      evidence({ requestedByUserId: '66666666-6666-4666-8666-666666666666' }),
      evidence({ attemptNumber: '1' as never }),
      evidence({ attemptNumber: 1.5 }),
      evidence({ attemptNumber: 0 }),
      evidence({ attemptNumber: 11 }),
      evidence({ claimedAt: malformedInstant }),
      evidence({ claimedAt: normalizedInstant }),
      evidence({ leaseExpiresAt: malformedInstant }),
      evidence({ claimedAt: '2026-09-08T10:30:01.000Z' }),
      evidence({ leaseExpiresAt: '2026-09-08T10:31:01.000Z' }),
      evidence({ leaseExpiresAt: CLAIMED_AT }),
    ];

    for (const durable of cases) {
      const app = fixedApplication(async () =>
        durable as PluginDeliveryAttemptClaimEvidence,
      );
      await expect(app.claim(CONTEXT, DELIVERY_ID, 60)).rejects.toBeInstanceOf(
        PluginDeliveryAttemptClaimAuthorityError,
      );
    }
  });

  it('collapses a revoked durable evidence proxy to the fixed authority error', async () => {
    const revoked = Proxy.revocable(evidence(), {});
    const durable = Promise.resolve(
      revoked.proxy as PluginDeliveryAttemptClaimEvidence,
    );
    revoked.revoke();
    const app = fixedApplication(() => durable);

    await expect(app.claim(CONTEXT, DELIVERY_ID, 60)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptClaimAuthorityError,
    );
  });

  it('exercises the runtime clock and UUID defaults without persisting raw claim material', async () => {
    const calls: unknown[] = [];
    const app = new PluginDeliveryAttemptClaimApplication({
      claimDue: async (command) => {
        calls.push(command);
        return {
          authorityVersion: 'life-os.plugin-delivery-attempt-claim.v1',
          deliveryId: command.deliveryId,
          workspaceId: command.workspaceId,
          requestedByUserId: command.requestedByUserId,
          attemptNumber: 1,
          claimedAt: command.claimedAt,
          leaseExpiresAt: command.leaseExpiresAt,
        };
      },
    });

    const lease = await app.claim(CONTEXT, DELIVERY_ID, 30);
    expect(lease.claimToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(
      new Date(lease.leaseExpiresAt).getTime() - new Date(lease.claimedAt).getTime(),
    ).toBe(30_000);
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toHaveProperty('claimToken');
  });

  it('collapses a revoked trusted context before claim persistence', async () => {
    let calls = 0;
    const app = fixedApplication(async () => {
      calls += 1;
      return undefined;
    });
    const revoked = Proxy.revocable(CONTEXT, {});
    revoked.revoke();

    await expect(app.claim(revoked.proxy, DELIVERY_ID, 60)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptClaimAuthorityError,
    );
    expect(calls).toBe(0);
  });
});
