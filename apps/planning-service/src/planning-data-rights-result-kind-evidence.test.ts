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
const IDEMPOTENCY_KEY = '44444444-4444-4444-8444-444444444444';
const AGGREGATE_ID = '55555555-5555-4555-8555-555555555555';
const REVISION_TOKEN = '66666666-6666-4666-8666-666666666666';
const REQUEST_DIGEST = 'a'.repeat(64);
const CREATED_AT = '2026-08-10T09:00:00.000Z';

/** Supplies one persisted Today idempotency row through the real export path. */
function exportClient(resultKind: unknown): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.includes('FROM planning.today_idempotency_records')) {
        return {
          rows: [
            {
              idempotency_key: IDEMPOTENCY_KEY,
              request_digest: REQUEST_DIGEST,
              result_kind: resultKind,
              aggregate_id: AGGREGATE_ID,
              revision_token: REVISION_TOKEN,
              payload_json: {
                version: 'life-os.today.v1',
                date: '2026-08-10',
                actions: [],
              },
              created_at: CREATED_AT,
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

describe('Planning data-rights Today result-kind evidence', () => {
  it.each(['replayed', 'CREATED', ' created ', 'other'])(
    'rejects persisted result_kind outside the Today persistence contract: %j',
    async (resultKind) => {
      const contributor = new PlanningDataRightsContributor(exportClient(resultKind));

      await expect(contributor.handle(exportRequest())).rejects.toBeInstanceOf(
        PlanningDataRightsError,
      );
    },
  );

  it.each(['created', 'updated'] as const)(
    'accepts canonical persisted result_kind %j',
    async (resultKind) => {
      const contributor = new PlanningDataRightsContributor(exportClient(resultKind));

      await expect(contributor.handle(exportRequest())).resolves.toMatchObject({
        operation: 'export',
        recordCount: 1,
        data: {
          todayIdempotencyRecords: [{ resultKind }],
        },
      });
    },
  );
});
