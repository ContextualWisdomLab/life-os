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
const LARGE_EXPORT_GOAL_COUNT = 10_001;

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

/** SQL double that exposes a workspace larger than one JSON safety page. */
function largeExportClient(): {
  readonly client: TodayTransactionalSqlClient;
  readonly goalQueryCount: () => number;
  readonly firstGoalId: string;
  readonly lastGoalId: string;
} {
  const goals = Array.from({ length: LARGE_EXPORT_GOAL_COUNT }, (_, index) => ({
    id: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
    title: `Goal ${index}`,
    created_at: new Date('2026-08-10T00:00:00.000Z'),
  }));
  let goalQueries = 0;
  const client: TodayTransactionalSqlClient = {
    async query<Row>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<{ rows: Row[] }> {
      if (!text.includes('FROM planning.goals')) {
        return { rows: [] };
      }
      goalQueries += 1;
      const pageSize =
        typeof values[1] === 'number' ? values[1] : LARGE_EXPORT_GOAL_COUNT;
      const offset = typeof values[2] === 'number' ? values[2] : 0;
      return {
        rows: goals.slice(offset, offset + pageSize) as unknown as Row[],
      };
    },
    async transaction<Result>(
      operation: (transaction: TodayTransactionalSqlClient) => Promise<Result>,
    ): Promise<Result> {
      return await operation(client);
    },
  };
  return {
    client,
    goalQueryCount: () => goalQueries,
    firstGoalId: goals[0].id,
    lastGoalId: goals.at(-1)?.id ?? '',
  };
}

describe('Planning data-rights runtime composition', () => {
  it('executes the service-owned data-rights contributor through the runtime', async () => {
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: TEST_DATABASE_URL },
      () => inertPool(),
    ) as PlanningRuntime & {
      readonly dataRightsContributor?: {
        handle(request: unknown): Promise<unknown>;
      };
    };

    try {
      const contributor = runtime.dataRightsContributor;
      expect(contributor).toBeDefined();
      if (!contributor) {
        throw new Error('Planning runtime did not compose its data-rights contributor');
      }

      const response = await contributor.handle({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'export',
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        requestId: REQUEST_ID,
      });

      expect(response).toMatchObject({
        contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
        operation: 'export',
        contributor: 'planning.service',
        requestId: REQUEST_ID,
        recordCount: 0,
      });
    } finally {
      await runtime.close();
    }
  });
});

describe('Planning data-rights export scale', () => {
  it('exports more than one safety page without truncation', async () => {
    const { client, goalQueryCount, firstGoalId, lastGoalId } =
      largeExportClient();
    const contributor = new PlanningDataRightsContributor(client);

    const response = await contributor.handle({
      contractVersion: DATA_RIGHTS_CONTRIBUTOR_CONTRACT_VERSION,
      operation: 'export',
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      requestId: REQUEST_ID,
    });

    expect(response).toMatchObject({
      operation: 'export',
      recordCount: LARGE_EXPORT_GOAL_COUNT,
    });
    if (response.operation !== 'export') {
      throw new Error('Expected Planning export response');
    }
    expect(response.sha256).toMatch(/^[0-9a-f]{64}$/u);
    if (
      response.data === null ||
      typeof response.data !== 'object' ||
      Array.isArray(response.data)
    ) {
      throw new Error('Expected Planning export object');
    }
    const exportedGoals = response.data.goals;
    if (!Array.isArray(exportedGoals)) {
      throw new Error('Expected Planning goals export array');
    }
    expect(exportedGoals).toHaveLength(LARGE_EXPORT_GOAL_COUNT);

    const firstExportedGoal = exportedGoals[0];
    const lastExportedGoal = exportedGoals.at(-1);
    expect(
      firstExportedGoal !== null &&
        typeof firstExportedGoal === 'object' &&
        !Array.isArray(firstExportedGoal)
        ? firstExportedGoal.id
        : undefined,
    ).toBe(firstGoalId);
    expect(
      lastExportedGoal !== null &&
        typeof lastExportedGoal === 'object' &&
        !Array.isArray(lastExportedGoal)
        ? lastExportedGoal.id
        : undefined,
    ).toBe(lastGoalId);
    expect(goalQueryCount()).toBeGreaterThan(1);
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
