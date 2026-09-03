import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryOriginPersistenceEvidenceError,
  PostgresPluginDeliveryOriginGrantStore,
  type PluginDeliveryOriginSqlClient,
  type PluginDeliveryOriginSqlResult,
} from './plugin-delivery-origin-repository';

const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

function malformedClient(
  result: unknown,
): PluginDeliveryOriginSqlClient {
  return {
    async query<Row>(): Promise<PluginDeliveryOriginSqlResult<Row>> {
      return result as PluginDeliveryOriginSqlResult<Row>;
    },
  };
}

describe('PostgresPluginDeliveryOriginGrantStore malformed SQL evidence', () => {
  it.each([
    ['null result envelope', null],
    ['array result envelope', []],
    ['null rows collection', { rows: null, rowCount: 0 }],
    ['undefined durable row', { rows: [undefined], rowCount: 1 }],
  ])('rejects %s inside the bounded persistence-evidence error contract', async (_label, result) => {
    const store = new PostgresPluginDeliveryOriginGrantStore(malformedClient(result));

    await expect(
      store.findById(GRANT_ID, INSTALLATION_ID, WORKSPACE_ID, USER_ID),
    ).rejects.toBeInstanceOf(PluginDeliveryOriginPersistenceEvidenceError);
  });
});
