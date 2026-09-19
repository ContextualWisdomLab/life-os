import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptRetryApplication,
  PluginDeliveryAttemptRetryAuthorityError,
  type PluginDeliveryAttemptRetryCommand,
  type PluginDeliveryAttemptRetryEvidence,
  type PluginDeliveryAttemptRetryStore,
} from './plugin-delivery-attempt-retry';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const CLAIM_TOKEN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OCCURRED_AT = '2026-09-09T03:00:00.000Z';

function context() {
  return { workspaceId: WORKSPACE_ID, actorUserId: USER_ID };
}

function evidence(
  overrides: Partial<PluginDeliveryAttemptRetryEvidence> = {},
): PluginDeliveryAttemptRetryEvidence {
  return {
    authorityVersion: 'life-os.plugin-delivery-attempt-retry.v1',
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    attemptNumber: 1,
    maxAttempts: 3,
    deliveryStatus: 'pending',
    occurredAt: OCCURRED_AT,
    nextAttemptAt: '2026-09-09T03:00:30.000Z',
    terminalAt: null,
    outcomeCode: 'retryable_failure',
    ...overrides,
  };
}

function storeFor(durable: unknown): PluginDeliveryAttemptRetryStore {
  return {
    async recordRetryableFailure(_command: PluginDeliveryAttemptRetryCommand) {
      return durable as PluginDeliveryAttemptRetryEvidence;
    },
  };
}

function appFor(
  durable: unknown,
  now: () => Date = () => new Date(OCCURRED_AT),
): PluginDeliveryAttemptRetryApplication {
  return new PluginDeliveryAttemptRetryApplication(storeFor(durable), now);
}

async function expectAuthorityError(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toEqual(
    new PluginDeliveryAttemptRetryAuthorityError(),
  );
}

describe('PluginDeliveryAttemptRetryApplication hostile evidence coverage', () => {
  it('bounds malformed trusted context, exact claim token and trusted clock before persistence', async () => {
    let durableCalls = 0;
    const store: PluginDeliveryAttemptRetryStore = {
      async recordRetryableFailure() {
        durableCalls += 1;
        return evidence();
      },
    };
    const app = new PluginDeliveryAttemptRetryApplication(
      store,
      () => new Date(OCCURRED_AT),
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwing = Object.defineProperty({}, 'workspaceId', {
      get() {
        throw new Error('trusted-context-detail-must-not-escape');
      },
    });

    for (const candidate of [null, [], revoked.proxy, throwing]) {
      await expectAuthorityError(
        app.recordRetryableFailure(
          candidate as never,
          DELIVERY_ID,
          CLAIM_TOKEN,
        ),
      );
    }
    await expectAuthorityError(
      app.recordRetryableFailure(context(), 'not-a-uuid', CLAIM_TOKEN),
    );
    await expectAuthorityError(
      app.recordRetryableFailure(
        context(),
        DELIVERY_ID,
        CLAIM_TOKEN.toUpperCase(),
      ),
    );
    expect(durableCalls).toBe(0);

    await expectAuthorityError(
      new PluginDeliveryAttemptRetryApplication(store, () => {
        throw new Error('clock-detail-must-not-escape');
      }).recordRetryableFailure(context(), DELIVERY_ID, CLAIM_TOKEN),
    );
    await expectAuthorityError(
      new PluginDeliveryAttemptRetryApplication(
        store,
        () => new Date('invalid'),
      ).recordRetryableFailure(context(), DELIVERY_ID, CLAIM_TOKEN),
    );
  });

  it('bounds malformed and hostile durable envelopes', async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwing = Object.defineProperty({}, 'authorityVersion', {
      get() {
        throw new Error('persistence-detail-must-not-escape');
      },
    });

    for (const durable of [null, [], revoked.proxy, throwing]) {
      await expectAuthorityError(
        appFor(durable).recordRetryableFailure(
          context(),
          DELIVERY_ID,
          CLAIM_TOKEN,
        ),
      );
    }
  });

  it('rejects malformed identity, retry-budget and occurrence evidence', async () => {
    const malformed: unknown[] = [
      { ...evidence(), authorityVersion: 'wrong-version' },
      evidence({ deliveryId: '66666666-6666-4666-8666-666666666666' }),
      evidence({ workspaceId: '77777777-7777-4777-8777-777777777777' }),
      evidence({ requestedByUserId: '88888888-8888-4888-8888-888888888888' }),
      { ...evidence(), attemptNumber: '1' },
      evidence({ attemptNumber: 0 }),
      evidence({ attemptNumber: 1.5 }),
      { ...evidence(), maxAttempts: '3' },
      evidence({ maxAttempts: 0 }),
      evidence({ maxAttempts: 11 }),
      evidence({ attemptNumber: 4, maxAttempts: 3 }),
      evidence({ occurredAt: 'not-an-instant' }),
      evidence({ occurredAt: '2026-02-30T03:00:00.000Z' }),
      evidence({ occurredAt: '2026-09-09T03:00:01.000Z' }),
    ];

    for (const durable of malformed) {
      await expectAuthorityError(
        appFor(durable).recordRetryableFailure(
          context(),
          DELIVERY_ID,
          CLAIM_TOKEN,
        ),
      );
    }
  });

  it('rejects impossible pending and failed retry transitions', async () => {
    const malformed: unknown[] = [
      evidence({ attemptNumber: 3, maxAttempts: 3 }),
      evidence({ outcomeCode: 'attempt_limit' }),
      evidence({ terminalAt: OCCURRED_AT }),
      evidence({ nextAttemptAt: 'not-an-instant' }),
      evidence({ nextAttemptAt: '2026-09-09T03:00:31.000Z' }),
      { ...evidence(), deliveryStatus: 'unknown' },
      evidence({
        deliveryStatus: 'failed',
        attemptNumber: 2,
        maxAttempts: 3,
        nextAttemptAt: null,
        terminalAt: OCCURRED_AT,
        outcomeCode: 'attempt_limit',
      }),
      evidence({
        deliveryStatus: 'failed',
        attemptNumber: 3,
        maxAttempts: 3,
        nextAttemptAt: null,
        terminalAt: OCCURRED_AT,
        outcomeCode: 'retryable_failure',
      }),
      evidence({
        deliveryStatus: 'failed',
        attemptNumber: 3,
        maxAttempts: 3,
        nextAttemptAt: OCCURRED_AT,
        terminalAt: OCCURRED_AT,
        outcomeCode: 'attempt_limit',
      }),
      evidence({
        deliveryStatus: 'failed',
        attemptNumber: 3,
        maxAttempts: 3,
        nextAttemptAt: null,
        terminalAt: '2026-09-09T03:00:01.000Z',
        outcomeCode: 'attempt_limit',
      }),
    ];

    for (const durable of malformed) {
      await expectAuthorityError(
        appFor(durable).recordRetryableFailure(
          context(),
          DELIVERY_ID,
          CLAIM_TOKEN,
        ),
      );
    }
  });

  it('accepts the bounded backoff cap at a late nonterminal attempt', async () => {
    const durable = evidence({
      attemptNumber: 9,
      maxAttempts: 10,
      nextAttemptAt: '2026-09-09T03:15:00.000Z',
    });

    await expect(
      appFor(durable).recordRetryableFailure(
        context(),
        DELIVERY_ID,
        CLAIM_TOKEN,
      ),
    ).resolves.toEqual(durable);
  });

  it('uses a canonical trusted instant when no clock override is supplied', async () => {
    let observed: PluginDeliveryAttemptRetryCommand | undefined;
    const store: PluginDeliveryAttemptRetryStore = {
      async recordRetryableFailure(command) {
        observed = command;
        return evidence({
          occurredAt: command.occurredAt,
          nextAttemptAt: new Date(
            new Date(command.occurredAt).getTime() + 30_000,
          ).toISOString(),
        });
      },
    };
    const app = new PluginDeliveryAttemptRetryApplication(store);

    const result = await app.recordRetryableFailure(
      context(),
      DELIVERY_ID,
      CLAIM_TOKEN,
    );
    expect(result.occurredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    );
    expect(result.occurredAt).toBe(observed?.occurredAt);
  });
});
