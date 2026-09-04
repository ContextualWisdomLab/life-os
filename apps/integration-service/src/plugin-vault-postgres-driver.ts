import { Pool } from 'pg';
import type {
  PluginHostedPostgresPool,
  PluginHostedPostgresResult,
} from './plugin-vault-hosted-runtime';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

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

/** Fixed driver-boundary failure that never reflects connection material. */
export class PluginNodePostgresConfigurationError extends Error {
  /** Creates the credential-free PostgreSQL authority failure surface. */
  constructor() {
    super('Integration PostgreSQL connection authority is incomplete');
    this.name = 'PluginNodePostgresConfigurationError';
  }
}

/** Fails closed without returning malformed PostgreSQL connection material. */
function unavailable(): never {
  throw new PluginNodePostgresConfigurationError();
}

/**
 * Requires one self-contained PostgreSQL URI before node-postgres sees process state.
 *
 * node-postgres documents that missing connection fields can be supplied by libpq-style
 * `PG*` environment variables and that connection-string query parameters can change
 * transport behavior. Requiring scheme, user, password, host, port, and database while
 * rejecting every query parameter keeps the Integration service's database target,
 * credential, and transport authority on one canonical configuration surface. TLS policy
 * still requires deployment acceptance; it cannot be disabled or replaced through the URI.
 */
function requireConnectionString(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    return unavailable();
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return unavailable();
  }

  const port = Number(parsed.port);
  const database = parsed.pathname.startsWith('/')
    ? parsed.pathname.slice(1)
    : '';
  if (
    !POSTGRES_PROTOCOLS.has(parsed.protocol) ||
    parsed.username.length === 0 ||
    parsed.password.length === 0 ||
    parsed.hostname.length === 0 ||
    parsed.port.length === 0 ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    database.length === 0 ||
    parsed.search.length !== 0 ||
    parsed.hash.length !== 0
  ) {
    return unavailable();
  }

  return value;
}

/**
 * Creates the concrete Integration-owned PostgreSQL pool consumed by Plugin runtime adapters.
 *
 * The connection string is supplied explicitly by the already-validated hosted runtime and is
 * required to carry complete target/credential authority before the node-postgres constructor is
 * invoked. The constructor therefore cannot fill missing core connection fields from generic
 * libpq-style `PG*` process settings or accept query-string transport overrides. Parameter arrays
 * are copied because node-postgres accepts mutable arrays while Integration repositories expose
 * readonly fixed-query values.
 */
export function createNodePostgresPluginPool(
  connectionString: string,
  PoolConstructor: NodePostgresPoolConstructor = Pool as unknown as NodePostgresPoolConstructor,
): PluginHostedPostgresPool {
  const pool = new PoolConstructor({
    connectionString: requireConnectionString(connectionString),
  });

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
