import { describe, expect, it } from 'vitest';
import {
  createPlanningRuntime,
  type PlanningPool,
  type PlanningRuntime,
} from './planning-runtime';

const TEST_DATABASE_URL = 'postgresql://planning:planning@127.0.0.1:5432/planning_test';

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
