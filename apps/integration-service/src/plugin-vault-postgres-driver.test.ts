import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
      'postgresql://integration:secret@db.example.test:5432/life_os',
      test.constructor,
    );

    expect(test.constructedWith).toHaveBeenCalledTimes(1);
    expect(test.constructedWith).toHaveBeenCalledWith({
      connectionString:
        'postgresql://integration:secret@db.example.test:5432/life_os',
    });
  });

  it.each([
    ['malformed URI', 'not-a-postgres-uri'],
    [
      'non-PostgreSQL scheme',
      'https://integration:secret@db.example.test:5432/life_os',
    ],
    ['missing user', 'postgresql://:secret@db.example.test:5432/life_os'],
    ['missing password', 'postgresql://integration@db.example.test:5432/life_os'],
    ['missing host', 'postgresql://integration:secret@:5432/life_os'],
    ['missing port', 'postgresql://integration:secret@db.example.test/life_os'],
    ['invalid port', 'postgresql://integration:secret@db.example.test:0/life_os'],
    ['missing database', 'postgresql://integration:secret@db.example.test:5432/'],
    [
      'query-string host override',
      'postgresql://integration:secret@db.example.test:5432/life_os?host=other.example.test',
    ],
    [
      'external passfile authority',
      'postgresql://integration:secret@db.example.test:5432/life_os?passfile=%2Frun%2Fsecrets%2Fpgpass',
    ],
    [
      'external service-file authority',
      'postgresql://integration:secret@db.example.test:5432/life_os?service=shared',
    ],
    [
      'query-string TLS downgrade',
      'postgresql://integration:secret@db.example.test:5432/life_os?sslmode=disable',
    ],
    [
      'query-string transport override',
      'postgresql://integration:secret@db.example.test:5432/life_os?ssl=false',
    ],
    [
      'query-string option outside the canonical authority contract',
      'postgresql://integration:secret@db.example.test:5432/life_os?application_name=other-runtime',
    ],
  ])(
    'rejects %s before node-postgres can inherit or override Integration-owned connection authority',
    (_label, connectionString) => {
      const test = fixture();

      expect(() =>
        createNodePostgresPluginPool(connectionString, test.constructor),
      ).toThrow();
      expect(test.constructedWith).not.toHaveBeenCalled();
    },
  );

  it('forwards fixed SQL and a copied parameter list while preserving row-count evidence', async () => {
    const test = fixture();
    const pool = createNodePostgresPluginPool(
      'postgresql://integration:secret@db.example.test:5432/life_os',
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
      'postgresql://integration:secret@db.example.test:5432/life_os',
      test.constructor,
    );

    await pool.end();

    expect(test.end).toHaveBeenCalledTimes(1);
  });

  it('declares the concrete PostgreSQL driver in both the service manifest and frozen-lock importer', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
    ) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const lockfile = readFileSync(
      resolve(__dirname, '../../../pnpm-lock.yaml'),
      'utf8',
    );
    const importerMarker = '  apps/integration-service:\n';
    const importerStart = lockfile.indexOf(importerMarker);

    expect(packageJson.dependencies?.pg).toBe('^8.22.0');
    expect(packageJson.devDependencies?.['@types/pg']).toBe('^8.20.0');
    expect(importerStart).toBeGreaterThanOrEqual(0);

    const importerTail = lockfile.slice(importerStart + importerMarker.length);
    const nextImporter = importerTail.indexOf('\n  apps/');
    const importer = importerTail.slice(
      0,
      nextImporter === -1 ? undefined : nextImporter,
    );

    expect(importer).toContain(
      '      pg:\n        specifier: ^8.22.0\n        version: 8.22.0',
    );
    expect(importer).toContain(
      "      '@types/pg':\n        specifier: ^8.20.0\n        version: 8.20.0",
    );
  });
});
