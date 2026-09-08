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

function activeGrant(): PluginDeliveryOriginGrantRecord {
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
  });
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

    const result = await application.schedule(CONTEXT, INSTALLATION_ID, {
      deliveryId: DELIVERY_ID,
      grantId: GRANT_ID,
      maxAttempts: 4,
    });

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

    await expect(
      application.schedule(CONTEXT, INSTALLATION_ID, {
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
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

    await expect(
      application.schedule(CONTEXT, INSTALLATION_ID, {
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
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

    await expect(
      application.schedule(hostileContext, INSTALLATION_ID, {
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
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

    await expect(
      application.schedule(CONTEXT, INSTALLATION_ID, hostileInput),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
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

    await expect(
      application.schedule(CONTEXT, INSTALLATION_ID, {
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
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

    await expect(
      application.schedule(CONTEXT, INSTALLATION_ID, {
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
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

    await expect(
      application.schedule(CONTEXT, INSTALLATION_ID, {
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
    expect(createIfAbsent).toHaveBeenCalledTimes(1);
  });

  it('bounds throwing durable attempt evidence after persistence I/O', async () => {
    const createIfAbsent = vi.fn(async (record: PluginDeliveryAttemptRecord) => {
      const hostile = { ...record };
      Object.defineProperty(hostile, 'status', {
        enumerable: true,
        get(): never {
          throw new Error('durable attempt accessor fixture detail');
        },
      });
      return hostile as PluginDeliveryAttemptRecord;
    });
    const application = new PluginDeliveryAttemptApplication(
      { createIfAbsent },
      { getGrant: vi.fn(async () => activeGrant()) },
      () => NOW,
    );

    await expect(
      application.schedule(CONTEXT, INSTALLATION_ID, {
        deliveryId: DELIVERY_ID,
        grantId: GRANT_ID,
        maxAttempts: 3,
      }),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptAuthorityError);
    expect(createIfAbsent).toHaveBeenCalledTimes(1);
  });
});
