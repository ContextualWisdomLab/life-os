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
 * Reproduces the failure boundary hidden by successful-only serialization tests.
 * One parallel export query fails while a later queued query is still running;
 * ROLLBACK must not reach the single PostgreSQL connection until that queue drains.
 */
function failingSingleFlightPool(): {
  readonly pool: PlanningPool;
  readonly releasedWithDestroy: () => boolean | undefined;
  readonly rollbackObserved: () => boolean;
} {
  let queryInFlight = false;
  let destroyed: boolean | undefined;
  let sawRollback = false;

  const connection: PlanningPoolConnection = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (queryInFlight) {
        throw new Error('Planning transaction control overlapped a queued query');
      }
      queryInFlight = true;
      try {
        if (text === 'ROLLBACK') {
          sawRollback = true;
        }
        if (text.includes('FROM planning.goals')) {
          throw new Error('Synthetic Planning export failure');
        }
        if (text.includes('FROM planning.projects')) {
          await new Promise((resolve) => setTimeout(resolve, 25));
        } else {
          await Promise.resolve();
        }
        return { rows: [] };
      } finally {
        queryInFlight = false;
      }
    },
    release(destroy = false): void {
      destroyed = destroy;
    },
  };

  return {
    pool: {
      async query<Row>(): Promise<{ rows: Row[] }> {
        return { rows: [] };
      },
      async connect(): Promise<PlanningPoolConnection> {
        return connection;
      },
      async end(): Promise<void> {},
    },
    releasedWithDestroy: () => destroyed,
    rollbackObserved: () => sawRollback,
  };
}

/**
 * Models a callback that admits SQL and returns before observing the query promise.
 * PostgreSQL aborts a transaction after a statement error, so transaction success must
 * not depend on whether application code happened to await every already-admitted query.
 */
function unobservedFailurePool(): {
  readonly pool: PlanningPool;
  readonly commitObserved: () => boolean;
  readonly rollbackObserved: () => boolean;
} {
  let sawCommit = false;
  let sawRollback = false;

  const connection: PlanningPoolConnection = {
    async query<Row>(text: string): Promise<{ rows: Row[] }> {
      if (text === 'SELECT synthetic_unobserved_failure') {
        throw new Error('Synthetic unobserved Planning query failure');
      }
      if (text === 'COMMIT') sawCommit = true;
      if (text === 'ROLLBACK') sawRollback = true;
      return { rows: [] };
    },
    release(): void {},
  };

  return {
    pool: {
      async query<Row>(): Promise<{ rows: Row[] }> {
        return { rows: [] };
      },
      async connect(): Promise<PlanningPoolConnection> {
        return connection;
      },
      async end(): Promise<void> {},
    },
    commitObserved: () => sawCommit,
    rollbackObserved: () => sawRollback,
  };
}

describe('Planning data-rights failed-query sequencing', () => {
  it('drains queued transaction queries before issuing rollback', async () => {
    const fixture = failingSingleFlightPool();
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: TEST_DATABASE_URL },
      () => fixture.pool,
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
      ).rejects.toThrow('Synthetic Planning export failure');

      expect(fixture.rollbackObserved()).toBe(true);
      expect(fixture.releasedWithDestroy()).toBe(false);
    } finally {
      await runtime.close();
    }
  });

  it('rejects transaction success when an already-admitted query fails unobserved', async () => {
    const fixture = unobservedFailurePool();
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: TEST_DATABASE_URL },
      () => fixture.pool,
    );
    const transactionalClient = runtime.dataRightsContributor['client'];
    let admittedFailure: Promise<unknown> | undefined;

    try {
      const transaction = transactionalClient.transaction(async (client) => {
        admittedFailure = client.query('SELECT synthetic_unobserved_failure', []);
        void admittedFailure.catch(() => undefined);
        return 'must-not-commit';
      });

      await expect(transaction).rejects.toThrow(
        'Synthetic unobserved Planning query failure',
      );
      await expect(admittedFailure).rejects.toThrow(
        'Synthetic unobserved Planning query failure',
      );
      expect(fixture.commitObserved()).toBe(false);
      expect(fixture.rollbackObserved()).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
