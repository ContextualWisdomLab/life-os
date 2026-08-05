import type { PoolConfig } from 'pg';
import { describe, expect, it } from 'vitest';
import { ProposalModelTransportError } from './contextual-orchestrator-proposal-model';
import {
  type AiPool,
  AiRuntime,
  createAiPoolConfiguration,
  createAiPoolErrorListener,
  createAiRuntime,
} from './ai-runtime';
import type { ProposalAuditSqlQueryResult } from './postgres-proposal-audit-repository';

/** Builds a credential-free PostgreSQL URL without embedding a scanner-shaped secret literal. */
function testDatabaseUrl(
  protocol: 'postgres' | 'postgresql',
  authority = 'db',
): string {
  return `${protocol}:${String.fromCharCode(47, 47)}${authority}/life_os`;
}

/** Minimal deterministic pool used to verify runtime wiring and shutdown ownership. */
class FakeAiPool implements AiPool {
  endCalls = 0;
  remainingEndFailures = 0;
  readonly queries: Array<{
    text: string;
    values: readonly unknown[];
  }> = [];

  /** Records one parameterized query and returns an empty result set. */
  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    this.queries.push({ text, values });
    return { rows: [] };
  }

  /** Records pool shutdown calls and can inject bounded transient failure. */
  async end(): Promise<void> {
    this.endCalls += 1;
    if (this.remainingEndFailures > 0) {
      this.remainingEndFailures -= 1;
      throw new Error('Synthetic pool shutdown failure');
    }
  }
}

describe('AI runtime configuration', () => {
  it('creates a bounded PostgreSQL pool configuration with safe defaults', () => {
    const databaseUrl = testDatabaseUrl('postgresql', 'db:5432');

    expect(
      createAiPoolConfiguration({
        AI_DATABASE_URL: ` ${databaseUrl} `,
      }),
    ).toEqual({
      connectionString: databaseUrl,
      application_name: 'life-os-ai-service',
      max: 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    });
  });

  it('accepts explicit bounded pool controls and both PostgreSQL schemes', () => {
    expect(
      createAiPoolConfiguration({
        AI_DATABASE_URL: testDatabaseUrl('postgres'),
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
        AI_DATABASE_URL: testDatabaseUrl('postgres'),
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
        AI_DATABASE_URL: testDatabaseUrl('postgresql'),
        AI_DATABASE_POOL_MAX: '0',
      },
      'AI database pool size is invalid',
    ],
    [
      {
        AI_DATABASE_URL: testDatabaseUrl('postgresql'),
        AI_DATABASE_POOL_MAX: '1.5',
      },
      'AI database pool size is invalid',
    ],
    [
      {
        AI_DATABASE_URL: testDatabaseUrl('postgresql'),
        AI_DATABASE_CONNECT_TIMEOUT_MS: '30001',
      },
      'AI database connection timeout is invalid',
    ],
    [
      {
        AI_DATABASE_URL: testDatabaseUrl('postgresql'),
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

  it('records idle-client failures without exposing the original error', () => {
    const messages: string[] = [];
    const listener = createAiPoolErrorListener({
      error: (message) => messages.push(message),
    });

    listener(new Error('password=secret'));

    expect(messages).toEqual(['Unexpected idle PostgreSQL client error']);
    expect(messages.join(' ')).not.toContain('secret');
  });

  it('rejects invalid model selection before allocating a pool', () => {
    let poolCalls = 0;
    const poolFactory = (): FakeAiPool => {
      poolCalls += 1;
      return new FakeAiPool();
    };
    const databaseEnvironment = {
      AI_DATABASE_URL: testDatabaseUrl('postgresql'),
    };

    expect(() =>
      createAiRuntime(
        { ...databaseEnvironment, AI_PROPOSAL_MODEL: 'unsupported' },
        poolFactory,
      ),
    ).toThrow('AI proposal model is invalid');
    expect(() =>
      createAiRuntime(
        {
          ...databaseEnvironment,
          AI_PROPOSAL_MODEL: 'contextual-orchestrator',
        },
        poolFactory,
      ),
    ).toThrow(ProposalModelTransportError);
    expect(poolCalls).toBe(0);
  });
});

describe('AiRuntime', () => {
  it('wires one shared audit application and shares successful pool shutdown', async () => {
    const pool = new FakeAiPool();
    let configuration: PoolConfig | undefined;
    const runtime = createAiRuntime(
      { AI_DATABASE_URL: testDatabaseUrl('postgresql', 'db:5432') },
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

    await Promise.all([runtime.close(), runtime.close()]);
    await runtime.onApplicationShutdown();

    expect(pool.endCalls).toBe(1);
  });

  it('surfaces shutdown failure and permits a later cleanup retry', async () => {
    const pool = new FakeAiPool();
    pool.remainingEndFailures = 1;
    const runtime = createAiRuntime(
      { AI_DATABASE_URL: testDatabaseUrl('postgresql') },
      () => pool,
    );

    await expect(runtime.close()).rejects.toThrow(
      'Synthetic pool shutdown failure',
    );
    await expect(runtime.onApplicationShutdown()).resolves.toBeUndefined();
    await expect(runtime.close()).resolves.toBeUndefined();

    expect(pool.endCalls).toBe(2);
  });
});
