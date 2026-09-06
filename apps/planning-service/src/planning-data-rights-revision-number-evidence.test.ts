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
const AGGREGATE_ID = '44444444-4444-4444-8444-444444444444';
const REVISION_TOKEN = '55555555-5555-4555-8555-555555555555';
const LOCAL_DATE = '2026-08-10';
const CREATED_AT = '2026-08-10T09:00:00.000Z';

/** Supplies one persisted Today aggregate through the real export transaction. */
function exportClient(revisionNumber: unknown): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.includes('FROM planning.today_aggregates')) {
        return {
          rows: [
            {
              local_date: LOCAL_DATE,
              aggregate_id: AGGREGATE_ID,
              revision_number: revisionNumber,
              revision_token: REVISION_TOKEN,
              payload_json: {
                version: 'life-os.today.v1',
                date: LOCAL_DATE,
                actions: [],
              },
              created_at: CREATED_AT,
              updated_at: CREATED_AT,
            } as unknown as Row,
          ],
        };
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

function exportRequest() {
  return {
    contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
    operation: 'export' as const,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    requestId: REQUEST_ID,
  };
}

describe('Planning data-rights Today revision-number evidence', () => {
  it.each([
    '0',
    '-1',
    '01',
    '+1',
    '1.0',
    ' 1 ',
    '9223372036854775808',
    'not-a-revision',
  ])('rejects persisted revision number outside PostgreSQL bigint domain: %j', async (revisionNumber) => {
    const contributor = new PlanningDataRightsContributor(exportClient(revisionNumber));

    await expect(contributor.handle(exportRequest())).rejects.toBeInstanceOf(
      PlanningDataRightsError,
    );
  });

  it.each(['1', '9223372036854775807'])(
    'accepts canonical positive PostgreSQL bigint revision number %j',
    async (revisionNumber) => {
      const contributor = new PlanningDataRightsContributor(exportClient(revisionNumber));

      await expect(contributor.handle(exportRequest())).resolves.toMatchObject({
        operation: 'export',
        recordCount: 1,
        data: {
          todayAggregates: [{ revisionNumber }],
        },
      });
    },
  );
});
