import { describe, expect, it } from 'vitest';
import { DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION } from './planning-data-rights';
import {
  createPlanningRuntime,
  type PlanningPool,
  type PlanningPoolConnection,
} from './planning-runtime';

const TEST_DATABASE_URL = ['postgresql:', '', '127.0.0.1', 'planning_test'].join(
  '/',
);
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

/**
 * Models node-postgres's single-connection contract by failing when a second
 * query is issued before the current transaction query has settled.
 */
function singleFlightPool(): PlanningPool {
  const connection: PlanningPoolConnection = {
    async query<Row>(): Promise<{ rows: Row[] }> {
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
    release(): void {},
  };
  let queryInFlight = false;
  return {
    async query<Row>(): Promise<{ rows: Row[] }> {
      return { rows: [] };
    },
    async connect(): Promise<PlanningPoolConnection> {
      return connection;
    },
    async end(): Promise<void> {},
  };
}

describe('Planning data-rights PostgreSQL query sequencing', () => {
  it('never overlaps queries on the single transaction connection', async () => {
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: TEST_DATABASE_URL },
      () => singleFlightPool(),
    );

    try {
      await expect(
        runtime.dataRightsContributor.handle({
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
    } finally {
      await runtime.close();
    }
  });
});
