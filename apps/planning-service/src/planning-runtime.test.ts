import type { PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  createPlanningPoolConfiguration,
  createPlanningRuntime,
  type PlanningPool,
  type PlanningPoolConnection,
} from './planning-runtime';

const DATABASE_URL = [
  'postgresql:',
  '',
  'database.example.test:5432',
  'life_os',
].join('/');

class FakePlanningConnection implements PlanningPoolConnection {
  readonly calls: string[] = [];
  released: boolean | undefined;

  constructor(private readonly failCommit = false) {}

  async query<Row>(text: string): Promise<{ rows: Row[] }> {
    this.calls.push(text);
    if (this.failCommit && text === 'COMMIT') {
      throw new Error('commit failed');
    }
    return { rows: [] };
  }

  release(destroy = false): void {
    this.released = destroy;
  }
}

class FakePlanningPool implements PlanningPool {
  endCalls = 0;
  readonly connections: FakePlanningConnection[] = [];

  async query<Row>(): Promise<{ rows: Row[] }> {
    return { rows: [] };
  }

  async connect(): Promise<PlanningPoolConnection> {
    const connection = new FakePlanningConnection();
    this.connections.push(connection);
    return connection;
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

  it('uses a dedicated transaction for Today writes and rolls back domain failures', async () => {
    const pool = new FakePlanningPool();
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: DATABASE_URL },
      () => pool,
    );

    await expect(
      runtime.todayService.putToday(
        '11111111-1111-4111-8111-111111111111',
        { version: 'life-os.today.v1', date: '2026-08-09', actions: [] },
        { kind: 'absent' },
        '22222222-2222-4222-8222-222222222222',
      ),
    ).rejects.toThrow();

    expect(pool.connections).toHaveLength(1);
    expect(pool.connections[0]?.calls[0]).toBe('BEGIN');
    expect(pool.connections[0]?.calls.at(-1)).toBe('ROLLBACK');
    expect(pool.connections[0]?.released).toBe(false);
    await runtime.close();
  });
});
