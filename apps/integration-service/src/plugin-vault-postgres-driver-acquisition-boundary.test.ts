import { describe, expect, it } from 'vitest';
import {
  createNodePostgresPluginPool,
  PluginNodePostgresConfigurationError,
  type NodePostgresPoolConstructor,
  type NodePostgresPoolLike,
} from './plugin-vault-postgres-driver';

const READINESS_SQL = 'SELECT 1 AS integration_plugin_runtime_ready';

function registrationFailurePool(options: {
  readonly cleanupRejects: boolean;
}): {
  readonly constructor: NodePostgresPoolConstructor;
  readonly endCalls: () => number;
} {
  let endCalls = 0;

  class RegistrationFailurePool implements NodePostgresPoolLike {
    on(): never {
      throw new Error('password=must-not-escape-listener-registration');
    }

    async query<Row>(): Promise<{
      readonly rows: readonly Row[];
      readonly rowCount: number | null;
    }> {
      return { rows: [], rowCount: 0 };
    }

    async end(): Promise<void> {
      endCalls += 1;
      if (options.cleanupRejects) {
        throw new Error('password=must-not-escape-pool-cleanup');
      }
    }
  }

  return {
    constructor: RegistrationFailurePool,
    endCalls: () => endCalls,
  };
}

function readinessFailurePool(options: {
  readonly cleanupRejects: boolean;
  readonly malformedResult?: boolean;
}): {
  readonly constructor: NodePostgresPoolConstructor;
  readonly endCalls: () => number;
  readonly queryCalls: () => readonly string[];
} {
  let endCalls = 0;
  const queryCalls: string[] = [];

  class ReadinessFailurePool implements NodePostgresPoolLike {
    on(): this {
      return this;
    }

    async query<Row>(text: string): Promise<{
      readonly rows: readonly Row[];
      readonly rowCount: number | null;
    }> {
      queryCalls.push(text);
      if (options.malformedResult) {
        return {
          rows: [
            { integration_plugin_runtime_ready: 0 },
          ] as unknown as readonly Row[],
          rowCount: 1,
        };
      }
      throw new Error('password=must-not-escape-readiness-probe');
    }

    async end(): Promise<void> {
      endCalls += 1;
      if (options.cleanupRejects) {
        throw new Error('password=must-not-escape-readiness-cleanup');
      }
    }
  }

  return {
    constructor: ReadinessFailurePool,
    endCalls: () => endCalls,
    queryCalls: () => queryCalls,
  };
}

describe('Integration PostgreSQL pool acquisition boundary', () => {
  it('bounds constructor failure before native detail can become startup evidence', async () => {
    class ConstructorFailurePool {
      constructor() {
        throw new Error('password=must-not-escape-pool-construction');
      }
    }

    const acquisition = Promise.resolve().then(() =>
      createNodePostgresPluginPool(
        'postgresql://integration:secret@db.example.test:5432/life_os',
        ConstructorFailurePool as unknown as NodePostgresPoolConstructor,
      ),
    );

    await expect(acquisition).rejects.toBeInstanceOf(
      PluginNodePostgresConfigurationError,
    );
    await expect(acquisition).rejects.not.toThrow(/must-not-escape/u);
  });

  it.each([false, true])(
    'closes a constructed pool before returning a bounded registration failure (cleanupRejects=%s)',
    async (cleanupRejects) => {
      const test = registrationFailurePool({ cleanupRejects });

      const acquisition = Promise.resolve().then(() =>
        createNodePostgresPluginPool(
          'postgresql://integration:secret@db.example.test:5432/life_os',
          test.constructor,
        ),
      );

      await expect(acquisition).rejects.toBeInstanceOf(
        PluginNodePostgresConfigurationError,
      );
      await expect(acquisition).rejects.not.toThrow(/must-not-escape/u);
      expect(test.endCalls()).toBe(1);
    },
  );

  it.each([false, true])(
    'requires a successful PostgreSQL readiness query before returning runtime authority and bounds cleanup failure (cleanupRejects=%s)',
    async (cleanupRejects) => {
      const test = readinessFailurePool({ cleanupRejects });

      const acquisition = Promise.resolve(
        createNodePostgresPluginPool(
          'postgresql://integration:secret@db.example.test:5432/life_os',
          test.constructor,
        ),
      );

      await expect(acquisition).rejects.toBeInstanceOf(
        PluginNodePostgresConfigurationError,
      );
      await expect(acquisition).rejects.not.toThrow(/must-not-escape/u);
      expect(test.queryCalls()).toEqual([READINESS_SQL]);
      expect(test.endCalls()).toBe(1);
    },
  );

  it('rejects malformed PostgreSQL readiness evidence before runtime authority crosses the acquisition boundary', async () => {
    const test = readinessFailurePool({
      cleanupRejects: false,
      malformedResult: true,
    });

    const acquisition = Promise.resolve(
      createNodePostgresPluginPool(
        'postgresql://integration:secret@db.example.test:5432/life_os',
        test.constructor,
      ),
    );

    await expect(acquisition).rejects.toBeInstanceOf(
      PluginNodePostgresConfigurationError,
    );
    expect(test.queryCalls()).toEqual([READINESS_SQL]);
    expect(test.endCalls()).toBe(1);
  });
});
