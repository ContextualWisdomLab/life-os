import { describe, expect, it } from 'vitest';
import type { PlanningSqlClient } from './postgres-planning-repository';
import type { TodayTransactionalSqlClient } from './postgres-today-repository';
import {
  createPlanningRuntime,
  type PlanningPool,
  type PlanningPoolConnection,
} from './planning-runtime';

const TEST_DATABASE_URL = ['postgresql:', '', '127.0.0.1', 'planning_test'].join(
  '/',
);

function capabilityLifetimePool(): {
  readonly pool: PlanningPool;
  readonly postReleaseQueries: () => number;
} {
  let released = false;
  let queriesAfterRelease = 0;

  const connection: PlanningPoolConnection = {
    async query<Row>(): Promise<{ rows: Row[] }> {
      if (released) {
        queriesAfterRelease += 1;
      }
      return { rows: [] };
    },
    release(): void {
      released = true;
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
    postReleaseQueries: () => queriesAfterRelease,
  };
}

function transactionAuthority(runtime: ReturnType<typeof createPlanningRuntime>): TodayTransactionalSqlClient {
  const authority = Reflect.get(runtime.dataRightsContributor, 'client');
  if (
    typeof authority !== 'object' ||
    authority === null ||
    typeof Reflect.get(authority, 'transaction') !== 'function'
  ) {
    throw new Error('Planning transaction authority fixture is unavailable');
  }
  return authority as TodayTransactionalSqlClient;
}

describe('Planning transaction SQL capability lifetime', () => {
  it('revokes the callback client before its connection is released', async () => {
    const fixture = capabilityLifetimePool();
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: TEST_DATABASE_URL },
      () => fixture.pool,
    );
    let escapedClient: PlanningSqlClient | undefined;

    try {
      await transactionAuthority(runtime).transaction(async (client) => {
        escapedClient = client;
      });

      expect(escapedClient).toBeDefined();
      await expect(escapedClient?.query('SELECT 1', [])).rejects.toThrow(
        'Planning transaction SQL capability is closed',
      );
      expect(fixture.postReleaseQueries()).toBe(0);
    } finally {
      await runtime.close();
    }
  });
});
