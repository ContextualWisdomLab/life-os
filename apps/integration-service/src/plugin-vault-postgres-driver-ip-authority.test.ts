import { describe, expect, it, vi } from 'vitest';
import {
  createNodePostgresPluginPool,
  PluginNodePostgresConfigurationError,
  type NodePostgresPoolConstructor,
} from './plugin-vault-postgres-driver';

function rejectingConstructorProbe(): {
  readonly constructor: NodePostgresPoolConstructor;
  readonly constructed: ReturnType<typeof vi.fn>;
} {
  const constructed = vi.fn();

  class ProbePool {
    constructor() {
      constructed();
    }

    on(): this {
      return this;
    }

    async query<Row>(): Promise<{
      readonly rows: readonly Row[];
      readonly rowCount: number | null;
    }> {
      return {
        rows: [],
        rowCount: 1,
      };
    }

    async end(): Promise<void> {
      return undefined;
    }
  }

  return {
    constructor: ProbePool as unknown as NodePostgresPoolConstructor,
    constructed,
  };
}

describe('Integration PostgreSQL TLS peer-identity authority', () => {
  it.each([
    'postgresql://integration:secret@127.0.0.1:5432/life_os',
    'postgresql://integration:secret@[::1]:5432/life_os',
  ])('rejects IP-literal database authority before node-postgres acquisition: %s', (url) => {
    const probe = rejectingConstructorProbe();

    expect(() => createNodePostgresPluginPool(url, probe.constructor)).toThrow(
      PluginNodePostgresConfigurationError,
    );
    expect(probe.constructed).not.toHaveBeenCalled();
  });
});
