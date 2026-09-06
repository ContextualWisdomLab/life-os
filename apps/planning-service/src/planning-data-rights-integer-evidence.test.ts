import { describe, expect, it } from 'vitest';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  PlanningDataRightsContributor,
  PlanningDataRightsError,
} from './planning-data-rights';
import type { TodayTransactionalSqlClient } from './postgres-today-repository';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

/** Supplies malformed scalar count evidence through the real verify-erased path. */
function malformedCountClient(recordCount: unknown): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.includes('AS record_count')) {
        return { rows: [{ record_count: recordCount } as unknown as Row] };
      }
      return { rows: [] };
    },
    async transaction<Result>(
      operation: (transaction: TodayTransactionalSqlClient) => Promise<Result>,
    ): Promise<Result> {
      return await operation(client);
    },
  };
  return client;
}

function verifyErasedRequest() {
  return {
    contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
    operation: 'verify_erased' as const,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
  };
}

describe('Planning data-rights integer evidence', () => {
  it.each(['0', '', ' 0 ', '0e0'])(
    'rejects malformed string record_count evidence %j',
    async (recordCount) => {
      const contributor = new PlanningDataRightsContributor(
        malformedCountClient(recordCount),
      );

      await expect(contributor.handle(verifyErasedRequest())).rejects.toBeInstanceOf(
        PlanningDataRightsError,
      );
    },
  );

  it('accepts canonical integer record_count evidence from the int4 query contract', async () => {
    const contributor = new PlanningDataRightsContributor(malformedCountClient(0));

    await expect(contributor.handle(verifyErasedRequest())).resolves.toMatchObject({
      operation: 'verify_erased',
      erased: true,
    });
  });
});
