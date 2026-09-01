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
 * Models node-postgres' single-client query contract by rejecting overlap.
 *
 * A transaction owns one database client. Starting another query before the
 * preceding query settles is deprecated by node-postgres and will become an
 * error in pg 9, so an export must serialize its service-owned reads while it
 * holds the repeatable-read snapshot.
 */
function serialOnlyExportClient(): TodayTransactionalSqlClient {
  let queryInFlight = false;
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.startsWith('SET TRANSACTION')) {
        return { rows: [] };
      }
      if (queryInFlight) {
        throw new Error('overlapping queries on one transaction client');
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

describe('Planning data-rights transaction query ordering', () => {
  it('serializes export reads on the transaction-owned PostgreSQL client', async () => {
    const contributor = new PlanningDataRightsContributor(serialOnlyExportClient());

    await expect(
      contributor.handle({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'export',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        requestId: REQUEST_ID,
      }),
    ).resolves.toMatchObject({
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'export',
      contributor: 'planning.service',
      requestId: REQUEST_ID,
      recordCount: 0,
    });
  });
});
