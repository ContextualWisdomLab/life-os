import { describe, expect, it } from 'vitest';
import type {
  PluginDeliveryOriginGrantRecord,
  RevokePluginDeliveryOriginGrant,
} from './plugin-delivery-origin-authority';
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

const MALFORMED_ENVELOPES: readonly unknown[] = [
  null,
  undefined,
  'invalid',
  [],
];

describe('PostgresPluginDeliveryOriginGrantStore malformed input envelopes', () => {
  it.each(MALFORMED_ENVELOPES)(
    'rejects malformed create envelope %# before SQL',
    async (malformed) => {
      const client = new NoIoSqlClient();
      const store = new PostgresPluginDeliveryOriginGrantStore(client);

      await expect(
        store.createIfAbsent(
          malformed as unknown as PluginDeliveryOriginGrantRecord,
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceValidationError);
      expect(client.calls).toBe(0);
    },
  );

  it.each(MALFORMED_ENVELOPES)(
    'rejects malformed revoke envelope %# before SQL',
    async (malformed) => {
      const client = new NoIoSqlClient();
      const store = new PostgresPluginDeliveryOriginGrantStore(client);

      await expect(
        store.revokeActive(
          malformed as unknown as RevokePluginDeliveryOriginGrant,
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceValidationError);
      expect(client.calls).toBe(0);
    },
  );
});
