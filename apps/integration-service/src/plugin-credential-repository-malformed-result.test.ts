import { describe, expect, it } from 'vitest';
import {
  PluginCredentialPersistenceEvidenceError,
  PostgresPluginCredentialBindingStore,
  type PluginCredentialSqlClient,
  type PluginCredentialSqlResult,
} from './plugin-credential-repository';

const BINDING_ID = '44444444-4444-4444-8444-444444444444';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

function malformedClient(result: unknown): PluginCredentialSqlClient {
  return {
    async query<Row>(): Promise<PluginCredentialSqlResult<Row>> {
      return result as PluginCredentialSqlResult<Row>;
    },
  };
}

describe('PostgresPluginCredentialBindingStore malformed SQL evidence', () => {
  it.each([
    ['null result envelope', null],
    ['array result envelope', []],
    ['null rows collection', { rows: null, rowCount: 0 }],
    ['null row count', { rows: [], rowCount: null }],
    ['mismatched row count', { rows: [], rowCount: 1 }],
    ['negative row count', { rows: [], rowCount: -1 }],
    ['multiple rows', { rows: [{}, {}], rowCount: 2 }],
    ['undefined durable row', { rows: [undefined], rowCount: 1 }],
    ['null durable row', { rows: [null], rowCount: 1 }],
  ])('rejects %s inside the bounded persistence-evidence error contract', async (_label, result) => {
    const store = new PostgresPluginCredentialBindingStore(malformedClient(result));

    await expect(
      store.findById(BINDING_ID, WORKSPACE_ID, USER_ID),
    ).rejects.toBeInstanceOf(PluginCredentialPersistenceEvidenceError);
  });
});
