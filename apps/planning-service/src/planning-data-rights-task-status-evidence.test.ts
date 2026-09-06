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
const TASK_ID = '44444444-4444-4444-8444-444444444444';
const PROJECT_ID = '55555555-5555-4555-8555-555555555555';
const CREATED_AT = '2026-08-10T09:00:00.000Z';

/** Supplies one persisted task row through the real Planning export path. */
function exportClient(status: unknown): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text.includes('FROM planning.tasks')) {
        return {
          rows: [
            {
              id: TASK_ID,
              project_id: PROJECT_ID,
              title: 'Durable task',
              status,
              completed_at: null,
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

describe('Planning data-rights task status evidence', () => {
  it.each(['blocked', 'TODO', ' done '])(
    'rejects persisted task status outside the Planning domain: %j',
    async (status) => {
      const contributor = new PlanningDataRightsContributor(exportClient(status));

      await expect(contributor.handle(exportRequest())).rejects.toBeInstanceOf(
        PlanningDataRightsError,
      );
    },
  );

  it.each(['todo', 'done'] as const)(
    'accepts canonical persisted task status %j',
    async (status) => {
      const contributor = new PlanningDataRightsContributor(exportClient(status));

      await expect(contributor.handle(exportRequest())).resolves.toMatchObject({
        operation: 'export',
        recordCount: 1,
        data: {
          tasks: [{ status }],
        },
      });
    },
  );
});
