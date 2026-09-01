import { describe, expect, it } from 'vitest';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  PlanningDataRightsContributor,
} from './planning-data-rights';
import type { TodayTransactionalSqlClient } from './postgres-today-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Models node-postgres's single-connection contract by failing when a second
 * query is issued before the current transaction query has settled.
 */
function singleFlightTransactionClient(): TodayTransactionalSqlClient {
  let queryInFlight = false;
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.startsWith('SET TRANSACTION')) {
        return { rows: [] };
      }
      if (queryInFlight) {
        throw new Error('Planning export overlapped transaction queries');
      }
      queryInFlight = true;
      try {
        await Promise.resolve();
        return { rows: [] };
      } finally {
        queryInFlight = false;
      }
    },
    async transaction<Result>(
      operation: (transaction: TodayTransactionalSqlClient) => Promise<Result>,
    ): Promise<Result> {
      return await operation(client);
    },
  };
  return client;
}

describe('Planning data-rights PostgreSQL query sequencing', () => {
  it('never overlaps queries on the single transaction connection', async () => {
    const contributor = new PlanningDataRightsContributor(
      singleFlightTransactionClient(),
    );

    await expect(
      contributor.handle({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'export',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        requestId: REQUEST_ID,
      }),
    ).resolves.toMatchObject({
      operation: 'export',
      recordCount: 0,
    });
  });
});
