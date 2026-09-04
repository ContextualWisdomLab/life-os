import { describe, expect, it, vi } from 'vitest';
import {
  createNodePostgresPluginPool,
  type NodePostgresPoolConstructor,
  type NodePostgresPoolLike,
} from './plugin-vault-postgres-driver';

function fixture(): {
  readonly constructor: NodePostgresPoolConstructor;
  readonly constructedWith: ReturnType<typeof vi.fn>;
  readonly query: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
} {
  const constructedWith = vi.fn();
  const query = vi.fn(async () => ({
    rows: [{ value: 'ok' }],
    rowCount: 1,
  }));
  const end = vi.fn(async () => undefined);

  class FixturePool implements NodePostgresPoolLike {
    constructor(configuration: Readonly<{ connectionString: string }>) {
      constructedWith(configuration);
    }

    async query<Row>(
      text: string,
      values?: readonly unknown[],
    ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }> {
      return (await query(text, values)) as {
        readonly rows: readonly Row[];
        readonly rowCount: number | null;
      };
    }

    async end(): Promise<void> {
      await end();
    }
  }

  return {
    constructor: FixturePool,
    constructedWith,
    query,
    end,
  };
}

describe('Integration-owned node-postgres Plugin pool', () => {
  it('constructs node-postgres only from the already-validated Integration connection string', () => {
    const test = fixture();

    createNodePostgresPluginPool(
      'postgresql://integration.example.test/life_os',
      test.constructor,
    );

    expect(test.constructedWith).toHaveBeenCalledTimes(1);
    expect(test.constructedWith).toHaveBeenCalledWith({
      connectionString: 'postgresql://integration.example.test/life_os',
    });
  });

  it('forwards fixed SQL and a copied parameter list while preserving row-count evidence', async () => {
    const test = fixture();
    const pool = createNodePostgresPluginPool(
      'postgresql://integration.example.test/life_os',
      test.constructor,
    );
    const values = Object.freeze(['workspace-1', 7]);

    const result = await pool.query<{ readonly value: string }>(
      'SELECT $1::text, $2::int',
      values,
    );

    expect(test.query).toHaveBeenCalledTimes(1);
    expect(test.query).toHaveBeenCalledWith(
      'SELECT $1::text, $2::int',
      ['workspace-1', 7],
    );
    expect(test.query.mock.calls[0]?.[1]).not.toBe(values);
    expect(result).toEqual({ rows: [{ value: 'ok' }], rowCount: 1 });
  });

  it('owns deterministic pool shutdown', async () => {
    const test = fixture();
    const pool = createNodePostgresPluginPool(
      'postgresql://integration.example.test/life_os',
      test.constructor,
    );

    await pool.end();

    expect(test.end).toHaveBeenCalledTimes(1);
  });
});
