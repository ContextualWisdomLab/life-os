import { describe, expect, it, vi } from 'vitest';
import type { PluginDeliveryOriginGrantRecord } from './plugin-delivery-origin-authority';
import {
  PluginDeliveryAttemptApplication,
  PluginDeliveryAttemptAuthorityError,
  type PluginDeliveryAttemptRecord,
  type PluginDeliveryAttemptStore,
} from './plugin-delivery-attempt';

const CONTEXT = Object.freeze({
  workspaceId: '33333333-3333-4333-8333-333333333333',
  actorUserId: '44444444-4444-4444-8444-444444444444',
});
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-09-08T04:40:00.000Z');
const INPUT = Object.freeze({
  deliveryId: DELIVERY_ID,
  grantId: GRANT_ID,
  maxAttempts: 4,
});

function activeGrant(
  overrides: Partial<PluginDeliveryOriginGrantRecord> = {},
): PluginDeliveryOriginGrantRecord {
  return Object.freeze({
    authorityVersion: 'life-os.plugin-delivery-origin.v1',
    grantId: GRANT_ID,
    installationId: INSTALLATION_ID,
    workspaceId: CONTEXT.workspaceId,
    grantedByUserId: CONTEXT.actorUserId,
    origin: 'https://api.example.com',
    status: 'active',
    grantedAt: '2026-09-08T04:30:00.000Z',
    revokedAt: null,
    ...overrides,
  }) as PluginDeliveryOriginGrantRecord;
}

function exactReplay(
  record: PluginDeliveryAttemptRecord,
): PluginDeliveryAttemptRecord {
  return Object.freeze({
    ...record,
    requestedAt: '2026-09-08T04:39:00.000Z',
    updatedAt: '2026-09-08T04:39:00.000Z',
    nextAttemptAt: '2026-09-08T04:39:00.000Z',
  });
}

function applicationWith(
  grant: PluginDeliveryOriginGrantRecord | undefined = activeGrant(),
  durable: (
    record: PluginDeliveryAttemptRecord,
  ) => PluginDeliveryAttemptRecord = exactReplay,
  now: () => Date = () => NOW,
): PluginDeliveryAttemptApplication {
  return new PluginDeliveryAttemptApplication(
    { createIfAbsent: async (record) => durable(record) },
    { getGrant: async () => grant },
    now,
  );
}

async function expectAuthorityFailure(
  application: PluginDeliveryAttemptApplication,
  context: unknown = CONTEXT,
  installationId: unknown = INSTALLATION_ID,
  input: unknown = INPUT,
): Promise<void> {
  await expect(
    application.schedule(context as never, installationId as never, input as never),
  ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
}

describe('plugin delivery attempt admission', () => {
  it('persists an opaque idempotent pending attempt without origin, credential, or payload material', async () => {
    const createIfAbsent = vi.fn(async (record: PluginDeliveryAttemptRecord) =>
      exactReplay(record),
    );
    const store: PluginDeliveryAttemptStore = { createIfAbsent };
    const grants = { getGrant: vi.fn(async () => activeGrant()) };
    const application = new PluginDeliveryAttemptApplication(
      store,
      grants,
      () => NOW,
    );

    const result = await application.schedule(CONTEXT, INSTALLATION_ID, INPUT);

    expect(result).toEqual({
      authorityVersion: 'life-os.plugin-delivery-attempt.v1',
      deliveryId: DELIVERY_ID,
      grantId: GRANT_ID,
      installationId: INSTALLATION_ID,
      workspaceId: CONTEXT.workspaceId,
      requestedByUserId: CONTEXT.actorUserId,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 4,
      requestedAt: '2026-09-08T04:39:00.000Z',
      updatedAt: '2026-09-08T04:39:00.000Z',
      nextAttemptAt: '2026-09-08T04:39:00.000Z',
      terminalAt: null,
      lastOutcomeCode: null,
    });
    expect(createIfAbsent).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('origin');
    expect(result).not.toHaveProperty('credential');
    expect(result).not.toHaveProperty('payload');
  });

  it('fails closed before persistence when current delivery-origin authority is absent or revoked', async () => {
    const createIfAbsent = vi.fn();
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant: vi.fn(async () => undefined) },
      () => NOW,
    );

    await expectAuthorityFailure(application);
    expect(createIfAbsent).not.toHaveBeenCalled();
  });

  it('rejects an idempotency collision whose durable winner changes authority scope', async () => {
    const createIfAbsent = vi.fn(async (record: PluginDeliveryAttemptRecord) =>
      Object.freeze({
        ...record,
        grantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      }),
    );
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant: vi.fn(async () => activeGrant()) },
      () => NOW,
    );

    await expectAuthorityFailure(application);
  });

  it('bounds throwing trusted-context access before origin or persistence authority', async () => {
    const createIfAbsent = vi.fn();
    const getGrant = vi.fn();
    const hostileContext = {
      get workspaceId(): never {
        throw new Error('trusted-context accessor fixture detail');
      },
      actorUserId: CONTEXT.actorUserId,
    };
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant },
      () => NOW,
    );

    await expectAuthorityFailure(application, hostileContext);
    expect(getGrant).not.toHaveBeenCalled();
    expect(createIfAbsent).not.toHaveBeenCalled();
  });

  it('bounds throwing request access before origin or persistence authority', async () => {
    const createIfAbsent = vi.fn();
    const getGrant = vi.fn();
    const hostileInput = {
      deliveryId: DELIVERY_ID,
      grantId: GRANT_ID,
      get maxAttempts(): never {
        throw new Error('request accessor fixture detail');
      },
    };
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant },
      () => NOW,
    );

    await expectAuthorityFailure(application, CONTEXT, INSTALLATION_ID, hostileInput);
    expect(getGrant).not.toHaveBeenCalled();
    expect(createIfAbsent).not.toHaveBeenCalled();
  });

  it('bounds delivery-origin dependency rejection before persistence authority', async () => {
    const createIfAbsent = vi.fn();
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      {
        getGrant: vi.fn(async () => {
          throw new Error(
            'origin repository credential fixture must never escape',
          );
        }),
      },
      () => NOW,
    );

    await expectAuthorityFailure(application);
    expect(createIfAbsent).not.toHaveBeenCalled();
  });

  it('bounds throwing origin evidence before persistence authority', async () => {
    const createIfAbsent = vi.fn();
    const hostileGrant = {
      ...activeGrant(),
      get status(): never {
        throw new Error('origin accessor fixture detail');
      },
    } as unknown as PluginDeliveryOriginGrantRecord;
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant: vi.fn(async () => hostileGrant) },
      () => NOW,
    );

    await expectAuthorityFailure(application);
    expect(createIfAbsent).not.toHaveBeenCalled();
  });

  it('bounds persistence dependency rejection without reflecting database detail', async () => {
    const createIfAbsent = vi.fn(async () => {
      throw new Error('database connection fixture must never escape');
    });
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant: vi.fn(async () => activeGrant()) },
      () => NOW,
    );

    await expectAuthorityFailure(application);
    expect(createIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('bounds throwing durable attempt evidence after persistence I/O', async () => {
    const createIfAbsent = vi.fn(
      async (record: PluginDeliveryAttemptRecord) => {
        const hostile = { ...record };
        Object.defineProperty(hostile, 'status', {
          enumerable: true,
          get(): never {
            throw new Error('durable attempt accessor fixture detail');
          },
        });
        return hostile as PluginDeliveryAttemptRecord;
      },
    );
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant: vi.fn(async () => activeGrant()) },
      () => NOW,
    );

    await expectAuthorityFailure(application);
    expect(createIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('collapses revoked shape checks for context, command, and durable evidence', async () => {
    const revokedContext = Proxy.revocable(CONTEXT, {});
    revokedContext.revoke();
    await expectAuthorityFailure(applicationWith(), revokedContext.proxy);

    const revokedInput = Proxy.revocable(INPUT, {});
    revokedInput.revoke();
    await expectAuthorityFailure(
      applicationWith(),
      CONTEXT,
      INSTALLATION_ID,
      revokedInput.proxy,
    );

    const application = applicationWith(activeGrant(), (record) => {
      const revokedRecord = Proxy.revocable(record, {});
      revokedRecord.revoke();
      return revokedRecord.proxy;
    });
    await expectAuthorityFailure(application);
  });

  it('rejects malformed context, installation identity, and scheduling input before origin authority', async () => {
    const invalidCases: ReadonlyArray<readonly [unknown, unknown, unknown]> = [
      [null, INSTALLATION_ID, INPUT],
      ['context', INSTALLATION_ID, INPUT],
      [[], INSTALLATION_ID, INPUT],
      [{ ...CONTEXT, workspaceId: 'not-a-uuid' }, INSTALLATION_ID, INPUT],
      [{ ...CONTEXT, actorUserId: 'not-a-uuid' }, INSTALLATION_ID, INPUT],
      [CONTEXT, 'not-a-uuid', INPUT],
      [CONTEXT, 123, INPUT],
      [CONTEXT, INSTALLATION_ID, null],
      [CONTEXT, INSTALLATION_ID, 'input'],
      [CONTEXT, INSTALLATION_ID, []],
      [CONTEXT, INSTALLATION_ID, { ...INPUT, deliveryId: 'not-a-uuid' }],
      [CONTEXT, INSTALLATION_ID, { ...INPUT, grantId: 'not-a-uuid' }],
      [CONTEXT, INSTALLATION_ID, { ...INPUT, maxAttempts: '4' }],
      [CONTEXT, INSTALLATION_ID, { ...INPUT, maxAttempts: 1.5 }],
      [CONTEXT, INSTALLATION_ID, { ...INPUT, maxAttempts: 0 }],
      [CONTEXT, INSTALLATION_ID, { ...INPUT, maxAttempts: 11 }],
    ];

    for (const [context, installationId, input] of invalidCases) {
      const getGrant = vi.fn();
      const createIfAbsent = vi.fn();
      const application = new PluginDeliveryAttemptApplication(
        { createIfAbsent },
        { getGrant },
        () => NOW,
      );
      await expectAuthorityFailure(application, context, installationId, input);
      expect(getGrant).not.toHaveBeenCalled();
      expect(createIfAbsent).not.toHaveBeenCalled();
    }
  });

  it('canonicalizes uppercase request identities before reading grant and persistence authority', async () => {
    const getGrant = vi.fn(async () => activeGrant());
    const createIfAbsent = vi.fn(async (record: PluginDeliveryAttemptRecord) => record);
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant },
      () => NOW,
    );

    const result = await application.schedule(
      {
        workspaceId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
        actorUserId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
      },
      'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
      {
        deliveryId: 'DDDDDDDD-DDDD-4DDD-8DDD-DDDDDDDDDDDD',
        grantId: 'EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE',
        maxAttempts: 4,
      },
    ).catch(() => undefined);

    expect(result).toBeUndefined();
    expect(getGrant).toHaveBeenCalledWith(
      {
        workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        actorUserId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    );
    expect(createIfAbsent).not.toHaveBeenCalled();
  });

  it('rejects invalid and hostile clock evidence before origin lookup', async () => {
    const clocks: Array<() => Date> = [
      () => new Date(Number.NaN),
      () => {
        throw new Error('clock detail must not escape');
      },
    ];
    for (const clock of clocks) {
      const getGrant = vi.fn();
      const application = new PluginDeliveryAttemptApplication(
        { createIfAbsent: vi.fn() },
        { getGrant },
        clock,
      );
      await expectAuthorityFailure(application);
      expect(getGrant).not.toHaveBeenCalled();
    }
  });

  it('uses the runtime clock default without weakening admission authority', async () => {
    const createIfAbsent = vi.fn(async (record: PluginDeliveryAttemptRecord) => record);
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant: vi.fn(async () => activeGrant()) },
    );

    const result = await application.schedule(CONTEXT, INSTALLATION_ID, INPUT);
    expect(Number.isFinite(new Date(result.requestedAt).getTime())).toBe(true);
    expect(result.updatedAt).toBe(result.requestedAt);
    expect(result.nextAttemptAt).toBe(result.requestedAt);
  });

  it('rejects malformed, foreign, revoked, and future grant evidence before persistence', async () => {
    const grantCases: Array<PluginDeliveryOriginGrantRecord | undefined> = [
      undefined,
      activeGrant({ grantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      activeGrant({ installationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      activeGrant({ workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      activeGrant({ grantedByUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      activeGrant({ status: 'revoked', revokedAt: '2026-09-08T04:35:00.000Z' }),
      activeGrant({ revokedAt: '2026-09-08T04:35:00.000Z' }),
      activeGrant({ grantedAt: 'not-an-instant' }),
      activeGrant({ grantedAt: '2026-02-31T04:30:00.000Z' }),
      activeGrant({ grantedAt: '2026-09-08T04:40:00.001Z' }),
    ];

    for (const grant of grantCases) {
      const createIfAbsent = vi.fn();
      const application = new PluginDeliveryAttemptApplication(
        { createIfAbsent },
        { getGrant: vi.fn(async () => grant) },
        () => NOW,
      );
      await expectAuthorityFailure(application);
      expect(createIfAbsent).not.toHaveBeenCalled();
    }
  });

  it('rejects malformed durable lifecycle, identities, counters, and chronology', async () => {
    const malformed: Array<
      (record: PluginDeliveryAttemptRecord) => unknown
    > = [
      () => null,
      () => [],
      (record) => ({ ...record, authorityVersion: 'life-os.plugin-delivery-attempt.v2' }),
      (record) => ({ ...record, status: 'failed' }),
      (record) => ({ ...record, attemptCount: 1 }),
      (record) => ({ ...record, terminalAt: record.requestedAt }),
      (record) => ({ ...record, lastOutcomeCode: 'retryable_failure' }),
      (record) => ({ ...record, maxAttempts: '4' }),
      (record) => ({ ...record, maxAttempts: 1.5 }),
      (record) => ({ ...record, maxAttempts: 0 }),
      (record) => ({ ...record, maxAttempts: 11 }),
      (record) => ({ ...record, requestedAt: 'not-an-instant' }),
      (record) => ({ ...record, requestedAt: '2026-02-31T04:40:00.000Z' }),
      (record) => ({ ...record, updatedAt: 'not-an-instant' }),
      (record) => ({ ...record, updatedAt: '2026-02-31T04:40:00.000Z' }),
      (record) => ({ ...record, nextAttemptAt: 'not-an-instant' }),
      (record) => ({ ...record, nextAttemptAt: '2026-02-31T04:40:00.000Z' }),
      (record) => ({
        ...record,
        requestedAt: NOW.toISOString(),
        updatedAt: '2026-09-08T04:39:59.999Z',
      }),
      (record) => ({
        ...record,
        requestedAt: NOW.toISOString(),
        nextAttemptAt: '2026-09-08T04:39:59.999Z',
      }),
      (record) => ({ ...record, deliveryId: 'not-a-uuid' }),
      (record) => ({ ...record, grantId: 'not-a-uuid' }),
      (record) => ({ ...record, installationId: 'not-a-uuid' }),
      (record) => ({ ...record, workspaceId: 'not-a-uuid' }),
      (record) => ({ ...record, requestedByUserId: 'not-a-uuid' }),
    ];

    for (const mutation of malformed) {
      const application = applicationWith(activeGrant(), (record) =>
        mutation(record) as PluginDeliveryAttemptRecord,
      );
      await expectAuthorityFailure(application);
    }
  });

  it('rejects valid durable records that are foreign or chronologically newer than the admission', async () => {
    const foreign: Array<
      (record: PluginDeliveryAttemptRecord) => PluginDeliveryAttemptRecord
    > = [
      (record) => ({ ...record, deliveryId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      (record) => ({ ...record, grantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      (record) => ({ ...record, installationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      (record) => ({ ...record, workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      (record) => ({ ...record, requestedByUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      (record) => ({ ...record, maxAttempts: 5 }),
      (record) => ({
        ...record,
        requestedAt: '2026-09-08T04:40:00.001Z',
        updatedAt: '2026-09-08T04:40:00.001Z',
        nextAttemptAt: '2026-09-08T04:40:00.001Z',
      }),
      (record) => ({ ...record, updatedAt: '2026-09-08T04:40:00.001Z' }),
      (record) => ({ ...record, nextAttemptAt: '2026-09-08T04:40:00.001Z' }),
    ];

    for (const mutation of foreign) {
      await expectAuthorityFailure(
        applicationWith(activeGrant(), (record) => mutation(record)),
      );
    }
  });
});
