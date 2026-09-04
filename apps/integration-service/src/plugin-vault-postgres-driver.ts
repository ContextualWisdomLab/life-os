import { Pool } from 'pg';
import type {
  PluginHostedPostgresPool,
  PluginHostedPostgresResult,
} from './plugin-vault-hosted-runtime';

/** Minimal node-postgres pool surface retained behind the Integration runtime port. */
export interface NodePostgresPoolLike {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }>;
  end(): Promise<void>;
}

/** Constructor seam used to verify exact connection authority without opening a socket. */
export type NodePostgresPoolConstructor = new (
  configuration: Readonly<{ connectionString: string }>,
) => NodePostgresPoolLike;

/**
 * Creates the concrete Integration-owned PostgreSQL pool consumed by Plugin runtime adapters.
 *
 * The connection string is supplied explicitly by the already-validated hosted runtime. The
 * node-postgres constructor therefore receives `{ connectionString }` rather than relying on
 * libpq-style process environment discovery, which would widen persistence authority beyond
 * `INTEGRATION_DATABASE_URL`. Parameter arrays are copied because node-postgres accepts mutable
 * arrays while Integration repositories expose readonly fixed-query values.
 */
export function createNodePostgresPluginPool(
  connectionString: string,
  PoolConstructor: NodePostgresPoolConstructor = Pool as unknown as NodePostgresPoolConstructor,
): PluginHostedPostgresPool {
  const pool = new PoolConstructor({ connectionString });

  return Object.freeze({
    async query<Row>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<PluginHostedPostgresResult<Row>> {
      const result = await pool.query<Row>(text, [...values]);
      return Object.freeze({
        rows: result.rows,
        rowCount: result.rowCount,
      });
    },
    async end(): Promise<void> {
      await pool.end();
    },
  });
}
