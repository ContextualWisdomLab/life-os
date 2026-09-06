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
const GOAL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CREATED_AT = '2026-08-10T09:00:00.000Z';

/** Supplies one persisted Planning goal through the real export transaction. */
function exportClient(goalId: unknown): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.includes('FROM planning.goals')) {
        return {
          rows: [
            {
              id: goalId,
              title: 'Canonical goal',
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

describe('Planning data-rights UUID evidence', () => {
  it('rejects noncanonical uppercase persisted UUID evidence', async () => {
    const contributor = new PlanningDataRightsContributor(
      exportClient(GOAL_ID.toUpperCase()),
    );

    await expect(contributor.handle(exportRequest())).rejects.toBeInstanceOf(
      PlanningDataRightsError,
    );
  });

  it('accepts canonical lowercase persisted UUID evidence', async () => {
    const contributor = new PlanningDataRightsContributor(exportClient(GOAL_ID));

    await expect(contributor.handle(exportRequest())).resolves.toMatchObject({
      operation: 'export',
      recordCount: 1,
      data: {
        goals: [{ id: GOAL_ID }],
      },
    });
  });
});
