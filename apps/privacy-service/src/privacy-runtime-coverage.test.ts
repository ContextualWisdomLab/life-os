import type { PoolConfig } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  NodePrivacyPool,
  NodePrivacyTransactionClient,
  defaultPrivacyPoolFactory,
} from './privacy-runtime';

const TEST_DATABASE_URL = [
  'postgresql:',
  '',
  'privacy_test_user@127.0.0.1:1',
  'privacy_test',
].join('/');

class FakePgClient {
  readonly query = vi.fn(async (_text: string, values?: unknown[]) => ({
    rows: [{ values: values ?? null }],
  }));
  readonly release = vi.fn(() => undefined);
}

class FakePgPool {
  readonly client = new FakePgClient();
  readonly connect = vi.fn(async () => this.client);
  readonly on = vi.fn(() => this);
  readonly end = vi.fn(async () => undefined);
}

describe('production privacy PostgreSQL adapters', () => {
  it('copies readonly values, supports no-value statements, and releases clients', async () => {
    const client = new FakePgClient();
    const adapter = new NodePrivacyTransactionClient(client as never);
    const values = Object.freeze(['tenant', 7]);
    await expect(adapter.query('SELECT $1, $2', values)).resolves.toEqual({
      rows: [{ values: ['tenant', 7] }],
    });
    await expect(adapter.query('COMMIT')).resolves.toEqual({
      rows: [{ values: null }],
    });
    expect(client.query.mock.calls[0]?.[1]).toEqual(['tenant', 7]);
    expect(client.query.mock.calls[0]?.[1]).not.toBe(values);
    adapter.release();
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('connects, registers pool errors, and closes the wrapped pg pool', async () => {
    const pool = new FakePgPool();
    const adapter = new NodePrivacyPool(pool as never);
    await expect(adapter.connect()).resolves.toBeInstanceOf(
      NodePrivacyTransactionClient,
    );
    const listener = vi.fn();
    adapter.on('error', listener);
    expect(pool.on).toHaveBeenCalledWith('error', listener);
    await adapter.end();
    expect(pool.end).toHaveBeenCalledOnce();
  });

  it('creates the default adapter without opening a database connection', async () => {
    const configuration: PoolConfig = {
      connectionString: TEST_DATABASE_URL,
      connectionTimeoutMillis: 100,
      max: 1,
    };
    const adapter = defaultPrivacyPoolFactory(configuration);
    expect(adapter).toBeInstanceOf(NodePrivacyPool);
    await adapter.end();
  });
});
