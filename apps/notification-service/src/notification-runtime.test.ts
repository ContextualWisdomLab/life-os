import { Logger } from '@nestjs/common';
import type { PoolConfig } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  createNotificationPoolConfiguration,
  createNotificationRuntime,
  registerNotificationPoolErrorHandler,
  type NotificationPool,
} from './notification-runtime';

const DATABASE_URL = [
  'postgresql:',
  '',
  'database.example.test:5432',
  'life_os',
].join('/');

/** Implements the fake notification pool test double with observable deterministic behavior. */
class FakeNotificationPool implements NotificationPool {
  endCalls = 0;
  endBehavior: () => Promise<void> = async () => undefined;
  readonly calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];

  /** Executes one parameterized query through the bounded SQL or test-double contract. */
  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values: [...values] });
    return { rows: [] };
  }

  /** Closes the owned resource without exposing connection details. */
  async end(): Promise<void> {
    this.endCalls += 1;
    await this.endBehavior();
  }
}

describe('Notification runtime', () => {
  it('emits bounded credential-free pool error classifications', () => {
    let errorListener: ((error: Error) => void) | undefined;
    const source = {
      on(event: 'error', listener: (error: Error) => void): void {
        expect(event).toBe('error');
        errorListener = listener;
      },
    };
    const logged: unknown[][] = [];
    registerNotificationPoolErrorHandler(source, (...values: unknown[]) => {
      logged.push(values);
    });

    errorListener?.(
      Object.assign(
        new Error('postgresql://administrator:secret@database.example.test'),
        { name: 'DatabaseError', code: '57P01' },
      ),
    );
    errorListener?.(
      Object.assign(new Error('secret'), {
        name: 'bad name',
        code: 'bad code',
      }),
    );
    errorListener?.(Object.assign(new Error('secret'), { code: 42 }));

    expect(logged).toEqual([
      [
        {
          message: 'Notification PostgreSQL pool reported an idle client error',
          context: 'NotificationRuntime',
          errorName: 'DatabaseError',
          postgresCode: '57P01',
        },
      ],
      [
        {
          message: 'Notification PostgreSQL pool reported an idle client error',
          context: 'NotificationRuntime',
          errorName: 'Error',
          postgresCode: null,
        },
      ],
      [
        {
          message: 'Notification PostgreSQL pool reported an idle client error',
          context: 'NotificationRuntime',
          errorName: 'Error',
          postgresCode: null,
        },
      ],
    ]);
    expect(JSON.stringify(logged)).not.toContain('secret');
  });

  it('uses the Nest logger without serializing the database error', () => {
    let errorListener: ((error: Error) => void) | undefined;
    const source = {
      on(_event: 'error', listener: (error: Error) => void): void {
        errorListener = listener;
      },
    };
    const logger = vi
      .spyOn(Logger, 'error')
      .mockImplementation(() => undefined);

    registerNotificationPoolErrorHandler(source);
    errorListener?.(
      new Error('postgresql://administrator:secret@database.example.test'),
    );

    expect(logger).toHaveBeenCalledWith(
      {
        message: 'Notification PostgreSQL pool reported an idle client error',
        context: 'NotificationRuntime',
        errorName: 'Error',
        postgresCode: null,
      },
      'NotificationRuntime',
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('secret');
    logger.mockRestore();
  });

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

  it('fails closed on missing, malformed, non-PostgreSQL, or oversized database configuration', () => {
    expect(() => createNotificationPoolConfiguration({})).toThrowError(
      'Required notification configuration is missing: NOTIFICATION_DATABASE_URL',
    );
    expect(() =>
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: 'not a URL',
      }),
    ).toThrowError('Notification database URL is invalid');
    expect(() =>
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: 'https://database.example.test/life_os',
      }),
    ).toThrowError('Notification database URL must use PostgreSQL');
    expect(() =>
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: `postgresql://${'a'.repeat(8 * 1024)}`,
      }),
    ).toThrowError(
      'Notification configuration exceeds maximum length: NOTIFICATION_DATABASE_URL',
    );
  });

  it('fails closed on non-integer or out-of-range pool configuration', () => {
    expect(() =>
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: DATABASE_URL,
        NOTIFICATION_DATABASE_POOL_MAX: '1.5',
      }),
    ).toThrowError('Notification database pool size is invalid');
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

  it('uses defaults for absent and blank optional integer configuration', () => {
    expect(
      createNotificationPoolConfiguration({
        NOTIFICATION_DATABASE_URL: DATABASE_URL,
        NOTIFICATION_DATABASE_POOL_MAX: '   ',
      }),
    ).toMatchObject({
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  });

  it('fails before allocating a pool for invalid scheduler bounds', () => {
    let poolFactoryCalls = 0;
    /** Creates a deterministic pool factory that records allocation attempts. */
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

  it('constructs and closes the production pool without opening a connection', async () => {
    const runtime = createNotificationRuntime({
      NOTIFICATION_DATABASE_URL: DATABASE_URL,
    });

    await runtime.close();
    await runtime.close();
  });

  it('shares one in-flight close promise across concurrent callers', async () => {
    const pool = new FakeNotificationPool();
    let releaseEnd: (() => void) | undefined;
    pool.endBehavior = () =>
      new Promise<void>((resolve) => {
        releaseEnd = resolve;
      });
    const runtime = createNotificationRuntime(
      { NOTIFICATION_DATABASE_URL: DATABASE_URL },
      () => pool,
    );

    const first = runtime.close();
    const second = runtime.onApplicationShutdown();
    let secondSettled = false;
    void second.then(() => {
      secondSettled = true;
    });
    await Promise.resolve();

    expect(pool.endCalls).toBe(1);
    expect(secondSettled).toBe(false);
    releaseEnd?.();
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
  });

  it('allows a later close attempt to retry a rejected pool shutdown', async () => {
    const pool = new FakeNotificationPool();
    let failureAvailable = true;
    pool.endBehavior = async () => {
      if (failureAvailable) {
        failureAvailable = false;
        throw new Error('shutdown unavailable');
      }
    };
    const runtime = createNotificationRuntime(
      { NOTIFICATION_DATABASE_URL: DATABASE_URL },
      () => pool,
    );

    await expect(runtime.close()).rejects.toThrowError('shutdown unavailable');
    await expect(runtime.close()).resolves.toBeUndefined();
    expect(pool.endCalls).toBe(2);
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
        '2026-08-04T12:00:00.000Z',
        0,
      ),
    ).resolves.toBeNull();
    expect(pool.calls).toHaveLength(1);
    expect(pool.calls[0]?.text).toContain(
      'UPDATE notification_service.reminder_occurrences',
    );
    expect(pool.calls[0]?.values?.[3]).toBe(600);
    expect(pool.calls[0]?.values?.[4]).toBe('2026-08-04T12:00:00.000Z');
    expect(pool.calls[0]?.values?.[5]).toBe(0);

    await runtime.onApplicationShutdown();
    await runtime.close();
    expect(pool.endCalls).toBe(1);
  });
});
