import { describe, expect, it } from 'vitest';
import type { PlanningSqlQueryResult } from './postgres-planning-repository';
import {
  PostgresTodayRepository,
  type TodayTransactionalSqlClient,
} from './postgres-today-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const DATE = '2026-08-09';

class RejectingQueryClient implements TodayTransactionalSqlClient {
  queryCalls = 0;

  async query<Row>(
    _text: string,
    _values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    this.queryCalls += 1;
    return { rows: [] };
  }

  async transaction<Result>(
    operation: (client: TodayTransactionalSqlClient) => Promise<Result>,
  ): Promise<Result> {
    return await operation(this);
  }
}

describe('PostgresTodayRepository lookup scope', () => {
  it('rejects a malformed workspace identifier before issuing SQL', async () => {
    const client = new RejectingQueryClient();
    const repository = new PostgresTodayRepository(client);

    await expect(repository.getToday('not-a-uuid', DATE)).rejects.toThrow();
    expect(client.queryCalls).toBe(0);
  });

  it('rejects an impossible local date before issuing SQL', async () => {
    const client = new RejectingQueryClient();
    const repository = new PostgresTodayRepository(client);

    await expect(repository.getToday(WORKSPACE_ID, '2026-02-30')).rejects.toThrow();
    expect(client.queryCalls).toBe(0);
  });
});
