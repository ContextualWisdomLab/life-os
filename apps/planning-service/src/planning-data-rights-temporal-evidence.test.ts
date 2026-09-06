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
const GOAL_ID = '44444444-4444-4444-8444-444444444444';
const AGGREGATE_ID = '55555555-5555-4555-8555-555555555555';
const REVISION_ID = '66666666-6666-4666-8666-666666666666';

type TemporalEvidenceCase = 'timestamp' | 'local-date';

/** Supplies impossible persisted calendar evidence through the real export mapper. */
function temporalEvidenceClient(
  evidenceCase: TemporalEvidenceCase,
): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (evidenceCase === 'timestamp' && text.includes('FROM planning.goals')) {
        return {
          rows: [
            {
              id: GOAL_ID,
              title: 'Temporal provenance',
              created_at: '2026-02-31T12:00:00.000Z',
            } as unknown as Row,
          ],
        };
      }
      if (
        evidenceCase === 'local-date' &&
        text.includes('FROM planning.today_aggregates')
      ) {
        return {
          rows: [
            {
              local_date: '2026-02-31',
              aggregate_id: AGGREGATE_ID,
              revision_number: '1',
              revision_token: REVISION_ID,
              payload_json: {},
              created_at: new Date('2026-02-28T12:00:00.000Z'),
              updated_at: new Date('2026-02-28T12:00:00.000Z'),
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

describe('Planning data-rights temporal evidence', () => {
  it('rejects a parser-normalized impossible persisted timestamp', async () => {
    const contributor = new PlanningDataRightsContributor(
      temporalEvidenceClient('timestamp'),
    );

    await expect(contributor.handle(exportRequest())).rejects.toBeInstanceOf(
      PlanningDataRightsError,
    );
  });

  it('rejects an impossible persisted local date', async () => {
    const contributor = new PlanningDataRightsContributor(
      temporalEvidenceClient('local-date'),
    );

    await expect(contributor.handle(exportRequest())).rejects.toBeInstanceOf(
      PlanningDataRightsError,
    );
  });
});
