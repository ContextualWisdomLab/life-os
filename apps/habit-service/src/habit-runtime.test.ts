import type { PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createHabitPoolConfiguration,
  createHabitRuntime,
  type HabitPool,
  type HabitPoolConnection,
} from './habit-runtime';

const DATABASE_URL = [
  'postgresql:',
  '',
  'database.example.test:5432',
  'life_os',
].join('/');

class FakeHabitConnection implements HabitPoolConnection {
  async query<Row>(): Promise<{ rows: Row[] }> {
    return { rows: [] };
  }

  release(): void {}
}

class FakeHabitPool implements HabitPool {
  endCalls = 0;

  async query<Row>(): Promise<{ rows: Row[] }> {
    return { rows: [] };
  }

  async connect(): Promise<HabitPoolConnection> {
    return new FakeHabitConnection();
  }

  async end(): Promise<void> {
    this.endCalls += 1;
  }
}

describe('Habit runtime', () => {
  it('builds a bounded PostgreSQL pool configuration', () => {
    expect(
      createHabitPoolConfiguration({
        HABIT_DATABASE_URL: DATABASE_URL,
        HABIT_DATABASE_POOL_MAX: '12',
        HABIT_DATABASE_CONNECT_TIMEOUT_MS: '2500',
        HABIT_DATABASE_IDLE_TIMEOUT_MS: '45000',
      }),
    ).toEqual({
      connectionString: DATABASE_URL,
      application_name: 'life-os-habit-service',
      max: 12,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 45000,
    });
  });

  it('fails closed on missing, non-PostgreSQL, or unbounded configuration', () => {
    expect(() => createHabitPoolConfiguration({})).toThrowError(
      'Required habit configuration is missing: HABIT_DATABASE_URL',
    );
    expect(() =>
      createHabitPoolConfiguration({
        HABIT_DATABASE_URL: 'https://database.example.test/life_os',
      }),
    ).toThrowError('Habit database URL must use PostgreSQL');
    expect(() =>
      createHabitPoolConfiguration({
        HABIT_DATABASE_URL: DATABASE_URL,
        HABIT_DATABASE_POOL_MAX: '33',
      }),
    ).toThrowError('Habit database pool size is invalid');
    expect(() =>
      createHabitPoolConfiguration({
        HABIT_DATABASE_URL: DATABASE_URL,
        HABIT_DATABASE_CONNECT_TIMEOUT_MS: '99',
      }),
    ).toThrowError('Habit database connection timeout is invalid');
    expect(() =>
      createHabitPoolConfiguration({
        HABIT_DATABASE_URL: DATABASE_URL,
        HABIT_DATABASE_IDLE_TIMEOUT_MS: '300001',
      }),
    ).toThrowError('Habit database idle timeout is invalid');
  });

  it('passes validated configuration to the pool and closes it once', async () => {
    const pool = new FakeHabitPool();
    let capturedConfiguration: PoolConfig | undefined;
    const runtime = createHabitRuntime(
      { HABIT_DATABASE_URL: DATABASE_URL },
      (configuration) => {
        capturedConfiguration = configuration;
        return pool;
      },
    );

    expect(capturedConfiguration).toMatchObject({
      connectionString: DATABASE_URL,
      application_name: 'life-os-habit-service',
      max: 10,
    });
    await runtime.onApplicationShutdown();
    await runtime.close();
    expect(pool.endCalls).toBe(1);
  });
});
