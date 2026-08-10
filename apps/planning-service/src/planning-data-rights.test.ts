import { describe, expect, it } from 'vitest';
import {
  DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
  PlanningDataRightsContributor,
} from './planning-data-rights';
import {
  createPlanningRuntime,
  type PlanningPool,
  type PlanningRuntime,
} from './planning-runtime';
import type { TodayTransactionalSqlClient } from './postgres-today-repository';

const TEST_DATABASE_URL = ['postgresql:', '', '127.0.0.1', 'planning_test'].join(
  '/',
);
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

/** Minimal credential-free pool used only to inspect runtime composition. */
function inertPool(): PlanningPool {
  return {
    async query<Row>(): Promise<{ rows: Row[] }> {
      return { rows: [] };
    },
    async connect() {
      return {
        async query<Row>(): Promise<{ rows: Row[] }> {
          return { rows: [] };
        },
        release(): void {},
      };
    },
    async end(): Promise<void> {},
  };
}

/** SQL double that reports whether the service-owned erasure receipt store exists. */
function preflightClient(erasureReceiptsReady: boolean): TodayTransactionalSqlClient {
  const client: TodayTransactionalSqlClient = {
    async query<Row>(): Promise<{ rows: Row[] }> {
      return {
        rows: [
          {
            erasure_receipts_ready: erasureReceiptsReady,
          } as unknown as Row,
        ],
      };
    },
    async transaction<Result>(
      operation: (transaction: TodayTransactionalSqlClient) => Promise<Result>,
    ): Promise<Result> {
      return await operation(client);
    },
  };
  return client;
}

describe('Planning data-rights runtime composition', () => {
  it('exposes one service-owned data-rights contributor', async () => {
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: TEST_DATABASE_URL },
      () => inertPool(),
    ) as PlanningRuntime & {
      readonly dataRightsContributor?: {
        handle(request: unknown): Promise<unknown>;
      };
    };

    expect(runtime.dataRightsContributor).toBeDefined();
    expect(typeof runtime.dataRightsContributor?.handle).toBe('function');
    await runtime.close();
  });
});

describe('Planning data-rights erasure preflight', () => {
  it('does not claim ready when erasure receipt persistence is unavailable', async () => {
    const contributor = new PlanningDataRightsContributor(preflightClient(false));

    const response = await contributor.handle({
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'erase_preflight',
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      requestId: REQUEST_ID,
    });

    expect(response).toMatchObject({
      operation: 'erase_preflight',
      ready: false,
      blockers: ['planning.data_rights_erasure_receipts unavailable'],
    });
  });
});
