import { describe, expect, it } from 'vitest';
import type {
  PluginCredentialBindingRecord,
  RevokePluginCredential,
} from './plugin-credential';
import {
  PluginCredentialPersistenceValidationError,
  PostgresPluginCredentialBindingStore,
  type PluginCredentialSqlClient,
  type PluginCredentialSqlResult,
} from './plugin-credential-repository';

class NoIoSqlClient implements PluginCredentialSqlClient {
  calls = 0;

  async query<Row>(
    _text: string,
    _values: readonly unknown[] = [],
  ): Promise<PluginCredentialSqlResult<Row>> {
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

describe('PostgresPluginCredentialBindingStore malformed input envelopes', () => {
  it.each(MALFORMED_ENVELOPES)(
    'rejects malformed create envelope %# before SQL',
    async (malformed) => {
      const client = new NoIoSqlClient();
      const store = new PostgresPluginCredentialBindingStore(client);

      await expect(
        store.createIfAbsent(malformed as unknown as PluginCredentialBindingRecord),
      ).rejects.toBeInstanceOf(PluginCredentialPersistenceValidationError);
      expect(client.calls).toBe(0);
    },
  );

  it.each(MALFORMED_ENVELOPES)(
    'rejects malformed revoke envelope %# before SQL',
    async (malformed) => {
      const client = new NoIoSqlClient();
      const store = new PostgresPluginCredentialBindingStore(client);

      await expect(
        store.revokeActive(malformed as unknown as RevokePluginCredential),
      ).rejects.toBeInstanceOf(PluginCredentialPersistenceValidationError);
      expect(client.calls).toBe(0);
    },
  );
});
