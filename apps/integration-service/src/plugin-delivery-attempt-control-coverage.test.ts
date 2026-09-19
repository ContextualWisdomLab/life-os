import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptControlApplication,
  PluginDeliveryAttemptControlAuthorityError,
  type PluginDeliveryAttemptControlEvidence,
  type PluginDeliveryAttemptControlStore,
} from './plugin-delivery-attempt-control';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const OTHER_DELIVERY_ID = '66666666-6666-4666-8666-666666666666';
const OCCURRED_AT = '2026-09-09T01:00:00.000Z';
const NEXT_ATTEMPT_AT = '2026-09-09T01:05:00.000Z';
const TERMINAL_AT = '2026-09-09T00:59:00.000Z';

function context(): {
  readonly workspaceId: string;
  readonly actorUserId: string;
} {
  return { workspaceId: WORKSPACE_ID, actorUserId: USER_ID };
}

function evidence(
  overrides: Partial<PluginDeliveryAttemptControlEvidence> = {},
): PluginDeliveryAttemptControlEvidence {
  return {
    authorityVersion: 'life-os.plugin-delivery-attempt-control.v1',
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    controlSequence: 1,
    controlCode: 'pause',
    deliveryStatus: 'paused',
    occurredAt: OCCURRED_AT,
    nextAttemptAt: NEXT_ATTEMPT_AT,
    terminalAt: null,
    ...overrides,
  };
}

function storeFor(
  controlCode: PluginDeliveryAttemptControlEvidence['controlCode'],
  durable: unknown,
): PluginDeliveryAttemptControlStore {
  const read = async () => durable as PluginDeliveryAttemptControlEvidence;
  return {
    pause: controlCode === 'pause' ? read : async () => undefined,
    resume: controlCode === 'resume' ? read : async () => undefined,
    deadLetter: controlCode === 'dead_letter' ? read : async () => undefined,
  };
}

async function expectAuthorityError(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    name: PluginDeliveryAttemptControlAuthorityError.name,
    message: 'Plugin delivery attempt control authority is invalid',
  });
}

describe('PluginDeliveryAttemptControlApplication hostile evidence coverage', () => {
  it('bounds malformed and hostile trusted context before durable access', async () => {
    let durableCalls = 0;
    const app = new PluginDeliveryAttemptControlApplication(
      {
        pause: async () => {
          durableCalls += 1;
          return evidence();
        },
        resume: async () => undefined,
        deadLetter: async () => undefined,
      },
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
      await expectAuthorityError(app.pause(candidate as never, DELIVERY_ID));
    }
    await expectAuthorityError(app.pause(context(), 'not-a-uuid'));

    expect(durableCalls).toBe(0);
  });

  it('bounds hostile clock evidence before durable access', async () => {
    const store: PluginDeliveryAttemptControlStore = {
      pause: async () => evidence(),
      resume: async () => undefined,
      deadLetter: async () => undefined,
    };

    await expectAuthorityError(
      new PluginDeliveryAttemptControlApplication(store, () => {
        throw new Error('clock-detail-must-not-escape');
      }).pause(context(), DELIVERY_ID),
    );
    await expectAuthorityError(
      new PluginDeliveryAttemptControlApplication(
        store,
        () => new Date('invalid'),
      ).pause(context(), DELIVERY_ID),
    );
  });

  it('rejects malformed or hostile durable envelopes with one fixed error', async () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const throwing = Object.defineProperty({}, 'authorityVersion', {
      get() {
        throw new Error('persistence-detail-must-not-escape');
      },
    });

    for (const durable of [null, [], revoked.proxy, throwing]) {
      const app = new PluginDeliveryAttemptControlApplication(
        storeFor('pause', durable),
        () => new Date(OCCURRED_AT),
      );
      await expectAuthorityError(app.pause(context(), DELIVERY_ID));
    }
  });

  it('rejects durable identity, version, code, sequence, and occurrence mismatches', async () => {
    const malformed: unknown[] = [
      evidence({
        authorityVersion: 'life-os.plugin-delivery-attempt-control.v1' as never,
        deliveryId: OTHER_DELIVERY_ID,
      }),
      evidence({ workspaceId: '77777777-7777-4777-8777-777777777777' }),
      evidence({ requestedByUserId: '88888888-8888-4888-8888-888888888888' }),
      evidence({ controlCode: 'resume' }),
      evidence({ controlSequence: 0 }),
      evidence({ controlSequence: 1.5 }),
      { ...evidence(), authorityVersion: 'wrong-version' },
      { ...evidence(), controlSequence: '1' },
      evidence({ occurredAt: '2026-09-09T01:00:01.000Z' }),
      evidence({ occurredAt: 'not-an-instant' }),
      evidence({ occurredAt: '2026-02-30T03:00:00.000Z' }),
    ];

    for (const durable of malformed) {
      const app = new PluginDeliveryAttemptControlApplication(
        storeFor('pause', durable),
        () => new Date(OCCURRED_AT),
      );
      await expectAuthorityError(app.pause(context(), DELIVERY_ID));
    }
  });

  it('rejects impossible pause and resume lifecycle evidence', async () => {
    for (const durable of [
      evidence({ deliveryStatus: 'pending' }),
      evidence({ nextAttemptAt: null }),
      evidence({ terminalAt: TERMINAL_AT }),
      evidence({ nextAttemptAt: 'not-an-instant' }),
      evidence({ nextAttemptAt: '2026-02-30T03:00:00.000Z' }),
    ]) {
      const app = new PluginDeliveryAttemptControlApplication(
        storeFor('pause', durable),
        () => new Date(OCCURRED_AT),
      );
      await expectAuthorityError(app.pause(context(), DELIVERY_ID));
    }

    for (const durable of [
      evidence({
        controlCode: 'resume',
        deliveryStatus: 'paused',
        nextAttemptAt: OCCURRED_AT,
      }),
      evidence({
        controlCode: 'resume',
        deliveryStatus: 'pending',
        nextAttemptAt: NEXT_ATTEMPT_AT,
      }),
      evidence({
        controlCode: 'resume',
        deliveryStatus: 'pending',
        nextAttemptAt: OCCURRED_AT,
        terminalAt: TERMINAL_AT,
      }),
    ]) {
      const app = new PluginDeliveryAttemptControlApplication(
        storeFor('resume', durable),
        () => new Date(OCCURRED_AT),
      );
      await expectAuthorityError(app.resume(context(), DELIVERY_ID));
    }
  });

  it('rejects impossible dead-letter lifecycle evidence', async () => {
    const validDeadLetter = evidence({
      controlCode: 'dead_letter',
      deliveryStatus: 'dead_lettered',
      nextAttemptAt: null,
      terminalAt: TERMINAL_AT,
    });

    for (const durable of [
      { ...validDeadLetter, deliveryStatus: 'pending' },
      { ...validDeadLetter, nextAttemptAt: OCCURRED_AT },
      { ...validDeadLetter, terminalAt: null },
      { ...validDeadLetter, terminalAt: '2026-09-09T01:00:01.000Z' },
      { ...validDeadLetter, terminalAt: 'not-an-instant' },
      { ...validDeadLetter, terminalAt: '2026-02-30T03:00:00.000Z' },
    ]) {
      const app = new PluginDeliveryAttemptControlApplication(
        storeFor('dead_letter', durable),
        () => new Date(OCCURRED_AT),
      );
      await expectAuthorityError(app.deadLetter(context(), DELIVERY_ID));
    }
  });
});
