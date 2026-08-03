import type { PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createPlanningPoolConfiguration,
  createPlanningRuntime,
  type PlanningPool,
} from './planning-runtime';

const DATABASE_URL = [
  'postgresql:',
  '',
  'database.example.test:5432',
  'life_os',
].join('/');

class FakePlanningPool implements PlanningPool {
  endCalls = 0;

  async query<Row>(): Promise<{ rows: Row[] }> {
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.endCalls += 1;
  }
}

describe('Planning runtime', () => {
  it('builds a bounded PostgreSQL pool configuration', () => {
    expect(
      createPlanningPoolConfiguration({
        PLANNING_DATABASE_URL: DATABASE_URL,
        PLANNING_DATABASE_POOL_MAX: '12',
        PLANNING_DATABASE_CONNECT_TIMEOUT_MS: '2500',
        PLANNING_DATABASE_IDLE_TIMEOUT_MS: '45000',
      }),
    ).toEqual({
      connectionString: DATABASE_URL,
      application_name: 'life-os-planning-service',
      max: 12,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 45000,
    });
  });

  it('fails closed on missing, non-PostgreSQL, or unbounded configuration', () => {
    expect(() => createPlanningPoolConfiguration({})).toThrowError(
      'Required planning configuration is missing: PLANNING_DATABASE_URL',
    );
    expect(() =>
      createPlanningPoolConfiguration({
        PLANNING_DATABASE_URL: 'https://database.example.test/life_os',
      }),
    ).toThrowError('Planning database URL must use PostgreSQL');
    expect(() =>
      createPlanningPoolConfiguration({
        PLANNING_DATABASE_URL: DATABASE_URL,
        PLANNING_DATABASE_POOL_MAX: '33',
      }),
    ).toThrowError('Planning database pool size is invalid');
    expect(() =>
      createPlanningPoolConfiguration({
        PLANNING_DATABASE_URL: DATABASE_URL,
        PLANNING_DATABASE_CONNECT_TIMEOUT_MS: '99',
      }),
    ).toThrowError('Planning database connection timeout is invalid');
    expect(() =>
      createPlanningPoolConfiguration({
        PLANNING_DATABASE_URL: DATABASE_URL,
        PLANNING_DATABASE_IDLE_TIMEOUT_MS: '300001',
      }),
    ).toThrowError('Planning database idle timeout is invalid');
  });

  it('passes validated configuration to the pool and closes it once', async () => {
    const pool = new FakePlanningPool();
    let capturedConfiguration: PoolConfig | undefined;
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: DATABASE_URL },
      (configuration) => {
        capturedConfiguration = configuration;
        return pool;
      },
    );

    expect(capturedConfiguration).toMatchObject({
      connectionString: DATABASE_URL,
      application_name: 'life-os-planning-service',
      max: 10,
    });
    await runtime.onApplicationShutdown();
    await runtime.close();
    expect(pool.endCalls).toBe(1);
  });
});
