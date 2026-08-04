import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const poolHarness = vi.hoisted(() => ({
  configurations: [] as unknown[],
  queries: [] as Array<{ text: string; values: unknown[] }>,
  listeners: [] as Array<(error: Error) => void>,
  endCalls: 0,
}));

vi.mock('pg', () => ({
  Pool: class MockPool {
    constructor(configuration: unknown) {
      poolHarness.configurations.push(configuration);
    }

    on(event: string, listener: (error: Error) => void): this {
      expect(event).toBe('error');
      poolHarness.listeners.push(listener);
      return this;
    }

    async query(text: string, values: unknown[]): Promise<{ rows: unknown[] }> {
      poolHarness.queries.push({ text, values });
      return { rows: [] };
    }

    async end(): Promise<void> {
      poolHarness.endCalls += 1;
    }
  },
}));

import { createAiRuntime } from './ai-runtime';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  poolHarness.configurations.length = 0;
  poolHarness.queries.length = 0;
  poolHarness.listeners.length = 0;
  poolHarness.endCalls = 0;
});

describe('default AI PostgreSQL runtime adapters', () => {
  it('constructs, queries, sanitizes idle errors, and closes the owned pool', async () => {
    const logger = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const databaseUrl = `postgresql:${String.fromCharCode(47, 47)}db/life_os`;
    const runtime = createAiRuntime({ AI_DATABASE_URL: databaseUrl });

    expect(poolHarness.configurations).toEqual([
      expect.objectContaining({
        connectionString: databaseUrl,
        application_name: 'life-os-ai-service',
      }),
    ]);
    expect(poolHarness.listeners).toHaveLength(1);
    poolHarness.listeners[0]!(new Error('password=secret'));
    expect(logger).toHaveBeenCalledWith(
      'Unexpected idle PostgreSQL client error',
    );
    expect(JSON.stringify(logger.mock.calls)).not.toContain('password=secret');

    await expect(runtime.application.listProposals(WORKSPACE_ID)).resolves.toEqual(
      [],
    );
    expect(poolHarness.queries).toHaveLength(1);
    expect(poolHarness.queries[0]?.values).toEqual([WORKSPACE_ID]);

    await runtime.close();
    expect(poolHarness.endCalls).toBe(1);
    logger.mockRestore();
  });
});
