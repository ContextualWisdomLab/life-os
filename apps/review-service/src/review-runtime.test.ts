import type { PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createReviewPoolConfiguration,
  createReviewRuntime,
  type ReviewPool,
} from './review-runtime';

const DATABASE_URL = [
  'postgresql:',
  '',
  'database.example.test:5432',
  'life_os',
].join('/');

class FakeReviewPool implements ReviewPool {
  endCalls = 0;

  async query<Row>(): Promise<{ rows: Row[] }> {
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.endCalls += 1;
  }
}

describe('Review runtime', () => {
  it('builds a bounded PostgreSQL pool configuration', () => {
    expect(
      createReviewPoolConfiguration({
        REVIEW_DATABASE_URL: DATABASE_URL,
        REVIEW_DATABASE_POOL_MAX: '12',
        REVIEW_DATABASE_CONNECT_TIMEOUT_MS: '2500',
        REVIEW_DATABASE_IDLE_TIMEOUT_MS: '45000',
      }),
    ).toEqual({
      connectionString: DATABASE_URL,
      application_name: 'life-os-review-service',
      max: 12,
      connectionTimeoutMillis: 2500,
      idleTimeoutMillis: 45000,
    });
  });

  it('fails closed on missing, non-PostgreSQL, or unbounded configuration', () => {
    expect(() => createReviewPoolConfiguration({})).toThrowError(
      'Required review configuration is missing: REVIEW_DATABASE_URL',
    );
    expect(() =>
      createReviewPoolConfiguration({
        REVIEW_DATABASE_URL: 'https://database.example.test/life_os',
      }),
    ).toThrowError('Review database URL must use PostgreSQL');
    expect(() =>
      createReviewPoolConfiguration({
        REVIEW_DATABASE_URL: DATABASE_URL,
        REVIEW_DATABASE_POOL_MAX: '33',
      }),
    ).toThrowError('Review database pool size is invalid');
    expect(() =>
      createReviewPoolConfiguration({
        REVIEW_DATABASE_URL: DATABASE_URL,
        REVIEW_DATABASE_CONNECT_TIMEOUT_MS: '99',
      }),
    ).toThrowError('Review database connection timeout is invalid');
    expect(() =>
      createReviewPoolConfiguration({
        REVIEW_DATABASE_URL: DATABASE_URL,
        REVIEW_DATABASE_IDLE_TIMEOUT_MS: '300001',
      }),
    ).toThrowError('Review database idle timeout is invalid');
  });

  it('passes validated configuration to the pool and closes it once', async () => {
    const pool = new FakeReviewPool();
    let capturedConfiguration: PoolConfig | undefined;
    const runtime = createReviewRuntime(
      { REVIEW_DATABASE_URL: DATABASE_URL },
      (configuration) => {
        capturedConfiguration = configuration;
        return pool;
      },
    );

    expect(capturedConfiguration).toMatchObject({
      connectionString: DATABASE_URL,
      application_name: 'life-os-review-service',
      max: 10,
    });
    await runtime.onApplicationShutdown();
    await runtime.close();
    expect(pool.endCalls).toBe(1);
  });
});
