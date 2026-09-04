import { describe, expect, it } from 'vitest';
import {
  createNodePostgresPluginPool,
  PluginNodePostgresConfigurationError,
  type NodePostgresPoolConstructor,
  type NodePostgresPoolLike,
} from './plugin-vault-postgres-driver';

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

describe('Integration PostgreSQL pool acquisition boundary', () => {
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
});
