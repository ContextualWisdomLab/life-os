import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptControlApplication,
  PluginDeliveryAttemptControlAuthorityError,
  type PluginDeliveryAttemptControlStore,
} from './plugin-delivery-attempt-control';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const OCCURRED_AT = '2026-09-09T01:00:00.000Z';
const EXHAUSTED_AT = '2026-09-09T00:59:00.000Z';

function context() {
  return { workspaceId: WORKSPACE_ID, actorUserId: USER_ID };
}

describe('PluginDeliveryAttemptControlApplication', () => {
  it('pauses an unclaimed pending delivery without granting execution authority', async () => {
    const calls: unknown[] = [];
    const store: PluginDeliveryAttemptControlStore = {
      pause: async (command) => {
        calls.push(command);
        return {
          authorityVersion: 'life-os.plugin-delivery-attempt-control.v1',
          deliveryId: DELIVERY_ID,
          workspaceId: WORKSPACE_ID,
          requestedByUserId: USER_ID,
          controlSequence: 1,
          controlCode: 'pause',
          deliveryStatus: 'paused',
          occurredAt: OCCURRED_AT,
          nextAttemptAt: '2026-09-09T01:05:00.000Z',
          terminalAt: null,
        };
      },
      resume: async () => undefined,
      deadLetter: async () => undefined,
    };
    const app = new PluginDeliveryAttemptControlApplication(
      store,
      () => new Date(OCCURRED_AT),
    );

    await expect(app.pause(context(), DELIVERY_ID)).resolves.toMatchObject({
      controlSequence: 1,
      controlCode: 'pause',
      deliveryStatus: 'paused',
      nextAttemptAt: '2026-09-09T01:05:00.000Z',
      terminalAt: null,
    });
    expect(calls).toEqual([
      {
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        occurredAt: OCCURRED_AT,
      },
    ]);
  });

  it('resumes a paused delivery as immediately due without resetting retry identity', async () => {
    const store: PluginDeliveryAttemptControlStore = {
      pause: async () => undefined,
      resume: async () => ({
        authorityVersion: 'life-os.plugin-delivery-attempt-control.v1',
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        controlSequence: 2,
        controlCode: 'resume',
        deliveryStatus: 'pending',
        occurredAt: OCCURRED_AT,
        nextAttemptAt: OCCURRED_AT,
        terminalAt: null,
      }),
      deadLetter: async () => undefined,
    };
    const app = new PluginDeliveryAttemptControlApplication(
      store,
      () => new Date(OCCURRED_AT),
    );

    await expect(app.resume(context(), DELIVERY_ID)).resolves.toMatchObject({
      controlSequence: 2,
      controlCode: 'resume',
      deliveryStatus: 'pending',
      occurredAt: OCCURRED_AT,
      nextAttemptAt: OCCURRED_AT,
      terminalAt: null,
    });
  });

  it('dead-letters only terminal retry exhaustion while preserving its terminal instant', async () => {
    const store: PluginDeliveryAttemptControlStore = {
      pause: async () => undefined,
      resume: async () => undefined,
      deadLetter: async () => ({
        authorityVersion: 'life-os.plugin-delivery-attempt-control.v1',
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        controlSequence: 1,
        controlCode: 'dead_letter',
        deliveryStatus: 'dead_lettered',
        occurredAt: OCCURRED_AT,
        nextAttemptAt: null,
        terminalAt: EXHAUSTED_AT,
      }),
    };
    const app = new PluginDeliveryAttemptControlApplication(
      store,
      () => new Date(OCCURRED_AT),
    );

    await expect(app.deadLetter(context(), DELIVERY_ID)).resolves.toMatchObject(
      {
        controlCode: 'dead_letter',
        deliveryStatus: 'dead_lettered',
        occurredAt: OCCURRED_AT,
        nextAttemptAt: null,
        terminalAt: EXHAUSTED_AT,
      },
    );
  });

  it('fails closed with one credential-free error when durable control authority is absent or rejects', async () => {
    for (const pause of [
      async () => undefined,
      async () => {
        throw new Error('database-native-detail-must-not-escape');
      },
    ]) {
      const app = new PluginDeliveryAttemptControlApplication(
        {
          pause,
          resume: async () => undefined,
          deadLetter: async () => undefined,
        },
        () => new Date(OCCURRED_AT),
      );
      await expect(app.pause(context(), DELIVERY_ID)).rejects.toMatchObject({
        name: PluginDeliveryAttemptControlAuthorityError.name,
        message: 'Plugin delivery attempt control authority is invalid',
      });
    }
  });
});
