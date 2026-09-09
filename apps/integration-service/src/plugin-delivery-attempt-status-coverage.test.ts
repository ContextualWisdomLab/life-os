import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptStatusApplication,
  PluginDeliveryAttemptStatusAuthorityError,
  type PluginDeliveryAttemptStatusCommand,
  type PluginDeliveryAttemptStatusEvidence,
  type PluginDeliveryAttemptStatusStore,
} from './plugin-delivery-attempt-status';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const REQUESTED_AT = '2026-09-09T01:20:00.000Z';
const UPDATED_AT = '2026-09-09T02:55:00.000Z';
const CHECKED_AT = '2026-09-09T03:00:00.000Z';

function context() {
  return { workspaceId: WORKSPACE_ID, actorUserId: USER_ID };
}

function evidence(
  overrides: Partial<PluginDeliveryAttemptStatusEvidence> = {},
): PluginDeliveryAttemptStatusEvidence {
  return {
    authorityVersion: 'life-os.plugin-delivery-attempt-status.v1',
    deliveryId: DELIVERY_ID,
    grantId: GRANT_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    deliveryStatus: 'pending',
    attemptCount: 1,
    maxAttempts: 3,
    requestedAt: REQUESTED_AT,
    updatedAt: UPDATED_AT,
    nextAttemptAt: REQUESTED_AT,
    terminalAt: null,
    lastOutcomeCode: null,
    controlSequence: 0,
    claimState: 'active',
    checkedAt: CHECKED_AT,
    ...overrides,
  };
}

function storeFor(durable: unknown): PluginDeliveryAttemptStatusStore {
  return {
    async read(_command: PluginDeliveryAttemptStatusCommand) {
      return durable as PluginDeliveryAttemptStatusEvidence;
    },
  };
}

function appFor(
  durable: unknown,
  now: () => Date = () => new Date(CHECKED_AT),
): PluginDeliveryAttemptStatusApplication {
  return new PluginDeliveryAttemptStatusApplication(storeFor(durable), now);
}

async function expectAuthorityError(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toEqual(
    new PluginDeliveryAttemptStatusAuthorityError(),
  );
}

describe('PluginDeliveryAttemptStatusApplication hostile evidence coverage', () => {
  it('accepts every representable lifecycle shape without exposing claim material', async () => {
    const cases: PluginDeliveryAttemptStatusEvidence[] = [
      evidence({
        attemptCount: 0,
        lastOutcomeCode: null,
        claimState: 'unclaimed',
      }),
      evidence({
        attemptCount: 2,
        lastOutcomeCode: 'retryable_failure',
        claimState: 'expired',
      }),
      evidence({
        attemptCount: 2,
        lastOutcomeCode: 'retryable_failure',
        claimState: 'unclaimed',
      }),
      evidence({
        deliveryStatus: 'paused',
        attemptCount: 0,
        lastOutcomeCode: null,
        claimState: 'unclaimed',
      }),
      evidence({
        deliveryStatus: 'paused',
        attemptCount: 2,
        lastOutcomeCode: 'retryable_failure',
        claimState: 'unclaimed',
      }),
      evidence({
        deliveryStatus: 'failed',
        attemptCount: 3,
        nextAttemptAt: null,
        terminalAt: UPDATED_AT,
        lastOutcomeCode: 'attempt_limit',
        claimState: 'unclaimed',
      }),
      evidence({
        deliveryStatus: 'dead_lettered',
        attemptCount: 3,
        nextAttemptAt: null,
        terminalAt: UPDATED_AT,
        lastOutcomeCode: 'attempt_limit',
        claimState: 'unclaimed',
      }),
    ];

    for (const durable of cases) {
      const result = await appFor(durable).read(context(), DELIVERY_ID);
      expect(result).toEqual(durable);
      expect(result).not.toHaveProperty('claimTokenDigest');
    }
  });

  it('bounds malformed trusted context, delivery identity, and clock evidence', async () => {
    let durableCalls = 0;
    const store: PluginDeliveryAttemptStatusStore = {
      async read() {
        durableCalls += 1;
        return evidence();
      },
    };
    const app = new PluginDeliveryAttemptStatusApplication(
      store,
      () => new Date(CHECKED_AT),
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwing = Object.defineProperty({}, 'workspaceId', {
      get() {
        throw new Error('trusted-context-detail-must-not-escape');
      },
    });

    for (const candidate of [null, [], revoked.proxy, throwing]) {
      await expectAuthorityError(app.read(candidate as never, DELIVERY_ID));
    }
    await expectAuthorityError(app.read(context(), 'not-a-uuid'));
    expect(durableCalls).toBe(0);

    await expectAuthorityError(
      new PluginDeliveryAttemptStatusApplication(store, () => {
        throw new Error('clock-detail-must-not-escape');
      }).read(context(), DELIVERY_ID),
    );
    await expectAuthorityError(
      new PluginDeliveryAttemptStatusApplication(
        store,
        () => new Date('invalid'),
      ).read(context(), DELIVERY_ID),
    );
  });

  it('bounds malformed or hostile durable envelopes', async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwing = Object.defineProperty({}, 'authorityVersion', {
      get() {
        throw new Error('persistence-detail-must-not-escape');
      },
    });

    for (const durable of [null, [], revoked.proxy, throwing]) {
      await expectAuthorityError(appFor(durable).read(context(), DELIVERY_ID));
    }
  });

  it('rejects malformed scalar authority evidence', async () => {
    const malformed: unknown[] = [
      { ...evidence(), authorityVersion: 'wrong-version' },
      evidence({ deliveryId: 'not-a-uuid' }),
      evidence({ grantId: 'not-a-uuid' }),
      evidence({ installationId: 'not-a-uuid' }),
      evidence({ workspaceId: 'not-a-uuid' }),
      evidence({ requestedByUserId: 'not-a-uuid' }),
      { ...evidence(), maxAttempts: '3' },
      evidence({ maxAttempts: 0 }),
      evidence({ maxAttempts: 11 }),
      { ...evidence(), attemptCount: '1' },
      evidence({ attemptCount: -1 }),
      evidence({ attemptCount: 4 }),
      { ...evidence(), controlSequence: '0' },
      evidence({ controlSequence: -1 }),
      evidence({ controlSequence: Number.MAX_SAFE_INTEGER + 1 }),
      { ...evidence(), deliveryStatus: 'unknown' },
      { ...evidence(), lastOutcomeCode: 'unknown' },
      { ...evidence(), claimState: 'unknown' },
      evidence({ requestedAt: 'not-an-instant' }),
      evidence({ updatedAt: '2026-02-30T03:00:00.000Z' }),
      evidence({ nextAttemptAt: 'not-an-instant' }),
      evidence({ terminalAt: 'not-an-instant' }),
      evidence({ checkedAt: 'not-an-instant' }),
    ];

    for (const durable of malformed) {
      await expectAuthorityError(appFor(durable).read(context(), DELIVERY_ID));
    }
  });

  it('rejects scope and chronology mismatches', async () => {
    const malformed: unknown[] = [
      evidence({ deliveryId: '66666666-6666-4666-8666-666666666666' }),
      evidence({ workspaceId: '77777777-7777-4777-8777-777777777777' }),
      evidence({ requestedByUserId: '88888888-8888-4888-8888-888888888888' }),
      evidence({ checkedAt: '2026-09-09T03:00:01.000Z' }),
      evidence({ updatedAt: '2026-09-09T01:19:59.999Z' }),
      evidence({ updatedAt: '2026-09-09T03:00:00.001Z' }),
      evidence({ requestedAt: '2026-09-09T03:00:00.001Z' }),
      evidence({ nextAttemptAt: '2026-09-09T01:19:59.999Z' }),
      evidence({
        deliveryStatus: 'failed',
        attemptCount: 3,
        nextAttemptAt: null,
        terminalAt: '2026-09-09T01:19:59.999Z',
        lastOutcomeCode: 'attempt_limit',
        claimState: 'unclaimed',
      }),
      evidence({
        deliveryStatus: 'failed',
        attemptCount: 3,
        nextAttemptAt: null,
        terminalAt: '2026-09-09T02:55:00.001Z',
        lastOutcomeCode: 'attempt_limit',
        claimState: 'unclaimed',
      }),
    ];

    for (const durable of malformed) {
      await expectAuthorityError(appFor(durable).read(context(), DELIVERY_ID));
    }
  });

  it('rejects non-representable lifecycle combinations', async () => {
    const malformed: unknown[] = [
      evidence({ attemptCount: 0, claimState: 'active' }),
      evidence({ attemptCount: 3, lastOutcomeCode: 'retryable_failure' }),
      evidence({ deliveryStatus: 'paused', claimState: 'active' }),
      evidence({
        deliveryStatus: 'failed',
        attemptCount: 3,
        nextAttemptAt: null,
        terminalAt: UPDATED_AT,
        lastOutcomeCode: 'attempt_limit',
        claimState: 'active',
      }),
      evidence({
        deliveryStatus: 'dead_lettered',
        attemptCount: 2,
        nextAttemptAt: null,
        terminalAt: UPDATED_AT,
        lastOutcomeCode: 'attempt_limit',
        claimState: 'unclaimed',
      }),
    ];

    for (const durable of malformed) {
      await expectAuthorityError(appFor(durable).read(context(), DELIVERY_ID));
    }
  });

  it('uses a canonical trusted instant when no clock override is supplied', async () => {
    let observed: PluginDeliveryAttemptStatusCommand | undefined;
    const store: PluginDeliveryAttemptStatusStore = {
      async read(command) {
        observed = command;
        return evidence({
          updatedAt: command.checkedAt,
          checkedAt: command.checkedAt,
          nextAttemptAt: command.checkedAt,
        });
      },
    };
    const app = new PluginDeliveryAttemptStatusApplication(store);

    const result = await app.read(context(), DELIVERY_ID);
    expect(result.checkedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    );
    expect(result.checkedAt).toBe(observed?.checkedAt);
  });
});
