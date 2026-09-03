import { describe, expect, it } from 'vitest';
import type { PluginDeliveryOriginGrantRecord } from './plugin-delivery-origin-authority';
import {
  PluginDeliveryOriginPersistenceValidationError,
  PostgresPluginDeliveryOriginGrantStore,
  type PluginDeliveryOriginSqlClient,
  type PluginDeliveryOriginSqlResult,
} from './plugin-delivery-origin-repository';

class NoIoSqlClient implements PluginDeliveryOriginSqlClient {
  calls = 0;

  async query<Row>(
    _text: string,
    _values: readonly unknown[] = [],
  ): Promise<PluginDeliveryOriginSqlResult<Row>> {
    this.calls += 1;
    throw new Error('SQL must not run for malformed persistence input');
  }
}

describe('PostgresPluginDeliveryOriginGrantStore malformed input envelopes', () => {
  it('rejects malformed create and revoke envelopes with the bounded validation error before SQL', async () => {
    const client = new NoIoSqlClient();
    const store = new PostgresPluginDeliveryOriginGrantStore(client);

    await expect(
      store.createIfAbsent(null as unknown as PluginDeliveryOriginGrantRecord),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceValidationError);
    await expect(store.revokeActive(null as never)).rejects.toBeInstanceOf(
      PluginDeliveryOriginPersistenceValidationError,
    );

    expect(client.calls).toBe(0);
  });
});
