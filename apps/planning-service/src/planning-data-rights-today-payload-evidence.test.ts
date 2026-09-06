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
function exportClient(payloadJson: unknown): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.includes('FROM planning.today_aggregates')) {
        return {
          rows: [
            {
              local_date: LOCAL_DATE,
              aggregate_id: AGGREGATE_ID,
              revision_number: '1',
              revision_token: REVISION_TOKEN,
              payload_json: payloadJson,
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

function todayPayload(date: string) {
  return {
    version: 'life-os.today.v1',
    date,
    actions: [],
  };
}

describe('Planning data-rights Today payload evidence', () => {
  it('rejects a persisted Today payload whose durable date contradicts its aggregate row', async () => {
    const contributor = new PlanningDataRightsContributor(
      exportClient(todayPayload('2026-08-11')),
    );

    await expect(contributor.handle(exportRequest())).rejects.toBeInstanceOf(
      PlanningDataRightsError,
    );
  });

  it('accepts a canonical persisted Today payload bound to the aggregate local date', async () => {
    const contributor = new PlanningDataRightsContributor(
      exportClient(todayPayload(LOCAL_DATE)),
    );

    await expect(contributor.handle(exportRequest())).resolves.toMatchObject({
      operation: 'export',
      recordCount: 1,
      data: {
        todayAggregates: [
          {
            localDate: LOCAL_DATE,
            payload: todayPayload(LOCAL_DATE),
          },
        ],
      },
    });
  });
});
