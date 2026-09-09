import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptExecutionFenceApplication,
  PluginDeliveryAttemptExecutionFenceAuthorityError,
  type PluginDeliveryAttemptExecutionFenceCommand,
  type PluginDeliveryAttemptExecutionFenceEvidence,
  type PluginDeliveryAttemptExecutionFenceStore,
} from './plugin-delivery-attempt-execution-fence';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN = '66666666-6666-4666-8666-666666666666';
const CHECKED_AT = '2026-09-09T02:00:00.000Z';
const CLAIM_EXPIRES_AT = '2026-09-09T02:05:00.000Z';
const CONTEXT = Object.freeze({
  workspaceId: WORKSPACE_ID,
  actorUserId: USER_ID,
});

function evidence(
  overrides: Partial<PluginDeliveryAttemptExecutionFenceEvidence> = {},
): PluginDeliveryAttemptExecutionFenceEvidence {
  return {
    authorityVersion: 'life-os.plugin-delivery-attempt-execution-fence.v1',
    deliveryId: DELIVERY_ID,
    grantId: GRANT_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    attemptNumber: 1,
    checkedAt: CHECKED_AT,
    claimExpiresAt: CLAIM_EXPIRES_AT,
    ...overrides,
  };
}

function application(
  durable: unknown,
  now: () => Date = () => new Date(CHECKED_AT),
): {
  readonly app: PluginDeliveryAttemptExecutionFenceApplication;
  readonly commands: PluginDeliveryAttemptExecutionFenceCommand[];
} {
  const commands: PluginDeliveryAttemptExecutionFenceCommand[] = [];
  const store: PluginDeliveryAttemptExecutionFenceStore = {
    check: async (command) => {
      commands.push(command);
      if (durable instanceof Error) {
        throw durable;
      }
      return durable as PluginDeliveryAttemptExecutionFenceEvidence | undefined;
    },
  };
  return {
    app: new PluginDeliveryAttemptExecutionFenceApplication(store, now),
    commands,
  };
}

describe('PluginDeliveryAttemptExecutionFenceApplication coverage boundaries', () => {
  it('rejects hostile request authority before durable lookup', async () => {
    const throwingContext = {
      get workspaceId(): string {
        throw new Error('hostile-context-detail');
      },
      actorUserId: USER_ID,
    };
    const cases: ReadonlyArray<
      readonly [unknown, unknown, unknown, () => Date]
    > = [
      [null, DELIVERY_ID, CLAIM_TOKEN, () => new Date(CHECKED_AT)],
      [[], DELIVERY_ID, CLAIM_TOKEN, () => new Date(CHECKED_AT)],
      [
        { workspaceId: 'not-a-uuid', actorUserId: USER_ID },
        DELIVERY_ID,
        CLAIM_TOKEN,
        () => new Date(CHECKED_AT),
      ],
      [
        { workspaceId: WORKSPACE_ID, actorUserId: 'not-a-uuid' },
        DELIVERY_ID,
        CLAIM_TOKEN,
        () => new Date(CHECKED_AT),
      ],
      [throwingContext, DELIVERY_ID, CLAIM_TOKEN, () => new Date(CHECKED_AT)],
      [CONTEXT, 'not-a-uuid', CLAIM_TOKEN, () => new Date(CHECKED_AT)],
      [CONTEXT, DELIVERY_ID, 123, () => new Date(CHECKED_AT)],
      [CONTEXT, DELIVERY_ID, 'not-a-uuid', () => new Date(CHECKED_AT)],
      [
        CONTEXT,
        DELIVERY_ID,
        'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF',
        () => new Date(CHECKED_AT),
      ],
      [CONTEXT, DELIVERY_ID, CLAIM_TOKEN, () => new Date(Number.NaN)],
      [
        CONTEXT,
        DELIVERY_ID,
        CLAIM_TOKEN,
        () => {
          throw new Error('clock-native-detail');
        },
      ],
    ];

    for (const [context, deliveryId, claimToken, now] of cases) {
      const { app, commands } = application(evidence(), now);
      await expect(
        app.check(
          context as typeof CONTEXT,
          deliveryId as string,
          claimToken as string,
        ),
      ).rejects.toBeInstanceOf(
        PluginDeliveryAttemptExecutionFenceAuthorityError,
      );
      expect(commands).toHaveLength(0);
    }
  });

  it('rejects malformed and contradictory durable fence evidence', async () => {
    const cases: unknown[] = [
      null,
      'not-an-object',
      [],
      evidence({
        authorityVersion:
          'life-os.plugin-delivery-attempt-execution-fence.v2' as never,
      }),
      evidence({ deliveryId: '77777777-7777-4777-8777-777777777777' }),
      evidence({ workspaceId: '77777777-7777-4777-8777-777777777777' }),
      evidence({ requestedByUserId: '77777777-7777-4777-8777-777777777777' }),
      evidence({ attemptNumber: '1' as never }),
      evidence({ attemptNumber: 1.5 }),
      evidence({ attemptNumber: 0 }),
      evidence({ attemptNumber: 11 }),
      evidence({ checkedAt: 'not-an-instant' }),
      evidence({ checkedAt: '2026-02-31T02:00:00.000Z' }),
      evidence({ checkedAt: '2026-09-09T02:00:01.000Z' }),
      evidence({ claimExpiresAt: 'not-an-instant' }),
      evidence({ claimExpiresAt: '2026-02-31T02:05:00.000Z' }),
      evidence({ claimExpiresAt: CHECKED_AT }),
      evidence({ grantId: 'not-a-uuid' }),
      evidence({ installationId: 'not-a-uuid' }),
    ];

    for (const durable of cases) {
      const { app } = application(durable);
      await expect(
        app.check(CONTEXT, DELIVERY_ID, CLAIM_TOKEN),
      ).rejects.toBeInstanceOf(
        PluginDeliveryAttemptExecutionFenceAuthorityError,
      );
    }
  });

  it('collapses revoked durable evidence getters to the fixed authority error', async () => {
    const revoked = Proxy.revocable(evidence(), {});
    revoked.revoke();
    const { app } = application(revoked.proxy);

    await expect(
      app.check(CONTEXT, DELIVERY_ID, CLAIM_TOKEN),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptExecutionFenceAuthorityError);
  });

  it('accepts Date-backed durable instants and canonicalizes grant authority', async () => {
    const store: PluginDeliveryAttemptExecutionFenceStore = {
      check: async (command) =>
        ({
          ...evidence(),
          grantId: GRANT_ID.toUpperCase(),
          installationId: INSTALLATION_ID.toUpperCase(),
          checkedAt: new Date(command.checkedAt),
          claimExpiresAt: new Date(
            new Date(command.checkedAt).getTime() + 60_000,
          ),
        }) as never,
    };
    const app = new PluginDeliveryAttemptExecutionFenceApplication(
      store,
      () => new Date(CHECKED_AT),
    );

    await expect(app.check(CONTEXT, DELIVERY_ID, CLAIM_TOKEN)).resolves.toEqual(
      {
        ...evidence(),
        claimExpiresAt: '2026-09-09T02:01:00.000Z',
      },
    );
  });

  it('exercises the runtime clock default while retaining exact scoped evidence', async () => {
    const store: PluginDeliveryAttemptExecutionFenceStore = {
      check: async (command) => ({
        ...evidence(),
        checkedAt: command.checkedAt,
        claimExpiresAt: new Date(
          new Date(command.checkedAt).getTime() + 60_000,
        ).toISOString(),
      }),
    };
    const app = new PluginDeliveryAttemptExecutionFenceApplication(store);

    const result = await app.check(CONTEXT, DELIVERY_ID, CLAIM_TOKEN);
    expect(result.deliveryId).toBe(DELIVERY_ID);
    expect(result.workspaceId).toBe(WORKSPACE_ID);
    expect(result.requestedByUserId).toBe(USER_ID);
    expect(
      new Date(result.claimExpiresAt).getTime() -
        new Date(result.checkedAt).getTime(),
    ).toBe(60_000);
  });
});
