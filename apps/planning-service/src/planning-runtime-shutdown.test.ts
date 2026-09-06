import { describe, expect, it } from 'vitest';
import {
  createPlanningRuntime,
  type PlanningPool,
  type PlanningPoolConnection,
} from './planning-runtime';

const TEST_DATABASE_URL = ['postgresql:', '', '127.0.0.1', 'planning_test'].join(
  '/',
);

function shutdownPool(): {
  readonly pool: PlanningPool;
  readonly releaseShutdown: () => void;
  readonly endCalls: () => number;
} {
  let releaseShutdown = (): void => {
    throw new Error('Planning shutdown was not started');
  };
  const shutdownGate = new Promise<void>((resolve) => {
    releaseShutdown = resolve;
  });
  let endCalls = 0;
  const connection: PlanningPoolConnection = {
    async query<Row>(): Promise<{ rows: Row[] }> {
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
      async end(): Promise<void> {
        endCalls += 1;
        await shutdownGate;
      },
    },
    releaseShutdown,
    endCalls: () => endCalls,
  };
}

describe('Planning runtime shutdown authority', () => {
  it('keeps every concurrent close caller pending until the shared pool shutdown completes', async () => {
    const fixture = shutdownPool();
    const runtime = createPlanningRuntime(
      { PLANNING_DATABASE_URL: TEST_DATABASE_URL },
      () => fixture.pool,
    );
    let secondSettled = false;

    const first = runtime.close();
    const second = runtime.onApplicationShutdown().then(() => {
      secondSettled = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.endCalls()).toBe(1);
    expect(secondSettled).toBe(false);

    fixture.releaseShutdown();
    await Promise.all([first, second]);
    expect(secondSettled).toBe(true);
    expect(fixture.endCalls()).toBe(1);
  });
});
