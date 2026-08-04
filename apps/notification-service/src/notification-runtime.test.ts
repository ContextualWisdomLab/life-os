import type { PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createNotificationPoolConfiguration,
  createNotificationRuntime,
  type NotificationPool,
} from './notification-runtime';

const DATABASE_URL = [
  'postgresql:',
  '',
  'database.example.test:5432',
  'life_os',
].join('/');

class FakeNotificationPool implements NotificationPool {
  endCalls = 0;
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values: [...values] });
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.endCalls += 1;
  }
}

describe('Notification runtime', () => {
  it('builds a bounded PostgreSQL pool configuration', () => {
    expect(
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: DATABASE_URL,
        NOTIFICATION_DATABASE_POOL_MAX: '12',
        NOTIFICATION_DATABASE_CONNECT_TIMEOUT_MS: '2500',
        NOTIFICATION_DATABASE_IDLE_TIMEOUT_MS: '45000',
      }),
    ).toEqual({
      connectionString: DATABASE_URL,
      application_name: 'life-os-notification-service',
      max: 12,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 45000,
    });
  });

  it('fails closed on missing, non-PostgreSQL, or unbounded pool configuration', () => {
    expect(() => createNotificationPoolConfiguration({})).toThrowError(
      'Required notification configuration is missing: NOTIFICATION_DATABASE_URL',
    );
    expect(() =>
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: 'https://database.example.test/life_os',
      }),
    ).toThrowError('Notification database URL must use PostgreSQL');
    expect(() =>
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: DATABASE_URL,
        NOTIFICATION_DATABASE_POOL_MAX: '33',
      }),
    ).toThrowError('Notification database pool size is invalid');
    expect(() =>
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: DATABASE_URL,
        NOTIFICATION_DATABASE_CONNECT_TIMEOUT_MS: '99',
      }),
    ).toThrowError('Notification database connection timeout is invalid');
    expect(() =>
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: DATABASE_URL,
        NOTIFICATION_DATABASE_IDLE_TIMEOUT_MS: '300001',
      }),
    ).toThrowError('Notification database idle timeout is invalid');
  });

  it('fails before allocating a pool for invalid scheduler bounds', () => {
    let poolFactoryCalls = 0;
    const poolFactory = (): NotificationPool => {
      poolFactoryCalls += 1;
      return new FakeNotificationPool();
    };

    expect(() =>
      createNotificationRuntime(
        {
          NOTIFICATION_DATABASE_URL: DATABASE_URL,
          NOTIFICATION_CLAIM_LEASE_SECONDS: '29',
        },
        poolFactory,
      ),
    ).toThrowError('Notification claim lease is invalid');
    expect(() =>
      createNotificationRuntime(
        {
          NOTIFICATION_DATABASE_URL: DATABASE_URL,
          NOTIFICATION_REMINDER_BATCH_SIZE: '101',
        },
        poolFactory,
      ),
    ).toThrowError('Notification reminder batch size is invalid');
    expect(poolFactoryCalls).toBe(0);
  });

  it('shares one pool across adapters and closes it exactly once', async () => {
    const pool = new FakeNotificationPool();
    let capturedConfiguration: PoolConfig | undefined;
    let factoryCalls = 0;
    const runtime = createNotificationRuntime(
      {
        NOTIFICATION_DATABASE_URL: DATABASE_URL,
        NOTIFICATION_CLAIM_LEASE_SECONDS: '600',
        NOTIFICATION_REMINDER_BATCH_SIZE: '25',
      },
      (configuration) => {
        factoryCalls += 1;
        capturedConfiguration = configuration;
        return pool;
      },
    );

    expect(factoryCalls).toBe(1);
    expect(capturedConfiguration).toMatchObject({
      connectionString: DATABASE_URL,
      application_name: 'life-os-notification-service',
      max: 10,
    });
    expect(runtime.scheduler.batchSize).toBe(25);
    await expect(
      runtime.repository.claim(
        '018f47a4-9976-4c57-8a8a-674630a873d1',
        '91fe0f58-2035-49b7-a793-ac75939a433f',
        'runtime-claim-key',
      ),
    ).resolves.toBe(false);
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.text).toContain(
      'UPDATE notification_service.reminder_occurrences',
    );
    expect(pool.calls[0]?.values?.[3]).toBe(600);

    await runtime.onApplicationShutdown();
    await runtime.close();
    expect(pool.endCalls).toBe(1);
  });
});
