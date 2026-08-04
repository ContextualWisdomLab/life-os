import type { PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  type AiPool,
  AiRuntime,
  createAiPoolConfiguration,
  createAiRuntime,
} from './ai-runtime';
import type { ProposalAuditSqlQueryResult } from './postgres-proposal-audit-repository';

class FakeAiPool implements AiPool {
  endCalls = 0;
  readonly queries: Array<{
    text: string;
    values: readonly unknown[];
  }> = [];

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    this.queries.push({ text, values });
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.endCalls += 1;
  }
}

describe('AI runtime configuration', () => {
  it('creates a bounded PostgreSQL pool configuration with safe defaults', () => {
    expect(
      createAiPoolConfiguration({
        AI_DATABASE_URL: ' postgresql://postgres:postgres@db:5432/life_os ',
      }),
    ).toEqual({
      connectionString: 'postgresql://postgres:postgres@db:5432/life_os',
      application_name: 'life-os-ai-service',
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  });

  it('accepts explicit bounded pool controls and both PostgreSQL schemes', () => {
    expect(
      createAiPoolConfiguration({
        AI_DATABASE_URL: 'postgres://postgres:postgres@db:5432/life_os',
        AI_DATABASE_POOL_MAX: '32',
        AI_DATABASE_CONNECT_TIMEOUT_MS: '100',
        AI_DATABASE_IDLE_TIMEOUT_MS: '300000',
      }),
    ).toMatchObject({
      max: 32,
      connectionTimeoutMillis: 100,
      idleTimeoutMillis: 300_000,
    });
    expect(
      createAiPoolConfiguration({
        AI_DATABASE_URL: 'postgres://postgres:postgres@db:5432/life_os',
        AI_DATABASE_POOL_MAX: ' ',
      }).max,
    ).toBe(10);
  });

  it.each([
    [{}, 'Required AI configuration is missing: AI_DATABASE_URL'],
    [
      { AI_DATABASE_URL: 'x'.repeat(8 * 1024 + 1) },
      'Required AI configuration is missing: AI_DATABASE_URL',
    ],
    [{ AI_DATABASE_URL: 'not a url' }, 'AI database URL is invalid'],
    [
      { AI_DATABASE_URL: 'https://db.example.test/life_os' },
      'AI database URL must use PostgreSQL',
    ],
    [
      {
        AI_DATABASE_URL: 'postgresql://db/life_os',
        AI_DATABASE_POOL_MAX: '0',
      },
      'AI database pool size is invalid',
    ],
    [
      {
        AI_DATABASE_URL: 'postgresql://db/life_os',
        AI_DATABASE_POOL_MAX: '1.5',
      },
      'AI database pool size is invalid',
    ],
    [
      {
        AI_DATABASE_URL: 'postgresql://db/life_os',
        AI_DATABASE_CONNECT_TIMEOUT_MS: '30001',
      },
      'AI database connection timeout is invalid',
    ],
    [
      {
        AI_DATABASE_URL: 'postgresql://db/life_os',
        AI_DATABASE_IDLE_TIMEOUT_MS: '999',
      },
      'AI database idle timeout is invalid',
    ],
  ] as const)(
    'rejects unsafe runtime configuration %#',
    (environment, message) => {
      expect(() => createAiPoolConfiguration(environment)).toThrow(message);
    },
  );
});

describe('AiRuntime', () => {
  it('wires one shared audit application and closes its pool exactly once', async () => {
    const pool = new FakeAiPool();
    let configuration: PoolConfig | undefined;
    const runtime = createAiRuntime(
      { AI_DATABASE_URL: 'postgresql://postgres:postgres@db:5432/life_os' },
      (value) => {
        configuration = value;
        return pool;
      },
    );

    expect(runtime).toBeInstanceOf(AiRuntime);
    expect(runtime.application).toBeDefined();
    expect(configuration).toMatchObject({
      application_name: 'life-os-ai-service',
      max: 10,
    });

    await runtime.close();
    await runtime.close();
    await runtime.onApplicationShutdown();

    expect(pool.endCalls).toBe(1);
  });
});
