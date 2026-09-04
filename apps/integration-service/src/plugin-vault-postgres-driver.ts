import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type {
  PluginHostedPostgresPool,
  PluginHostedPostgresResult,
} from './plugin-vault-hosted-runtime';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const PLUGIN_POSTGRES_POOL_MAX = 10;
const PLUGIN_POSTGRES_CONNECTION_TIMEOUT_MS = 5_000;
const PLUGIN_POSTGRES_IDLE_TIMEOUT_MS = 30_000;
const PLUGIN_POSTGRES_MAX_LIFETIME_SECONDS = 300;
const PLUGIN_POSTGRES_POOL_ERROR_MESSAGE =
  'Integration PostgreSQL pool reported an idle client error';
const SAFE_POOL_ERROR_NAMES = new Set(['Error', 'DatabaseError']);
const SAFE_POSTGRES_SQLSTATES = new Set([
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  '53000',
  '53100',
  '53200',
  '53300',
  '53400',
  '57000',
  '57014',
  '57P01',
  '57P02',
  '57P03',
  '57P04',
  '57P05',
  '58000',
  '58030',
  '58P01',
  '58P02',
  '58P03',
]);

/** Exact node-postgres lifecycle configuration owned by the Integration runtime. */
export interface NodePostgresPluginPoolConfiguration {
  readonly connectionString: string;
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly idleTimeoutMillis: number;
  readonly maxLifetimeSeconds: number;
}

/** Minimal node-postgres pool surface retained behind the Integration runtime port. */
export interface NodePostgresPoolLike {
  on(event: 'error', listener: (error: Error) => void): unknown;
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }>;
  end(): Promise<void>;
}

/** Constructor seam used to verify exact connection authority without opening a socket. */
export type NodePostgresPoolConstructor = new (
  configuration: Readonly<NodePostgresPluginPoolConfiguration>,
) => NodePostgresPoolLike;

/** Credential-free evidence retained when an idle PostgreSQL client fails. */
export interface PluginPostgresPoolErrorRecord {
  readonly message: string;
  readonly context: 'IntegrationPluginPostgresRuntime';
  readonly errorName: string;
  readonly postgresCode: string | null;
}

/** Error-observation seam used to prove idle-client failures cannot serialize native detail. */
export type PluginPostgresPoolErrorLogger = (
  record: PluginPostgresPoolErrorRecord,
) => void;

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
 * Retains only the two non-secret error class names expected at this boundary.
 *
 * A character whitelist is insufficient because an arbitrary credential-shaped string can still
 * contain only letters, digits, punctuation, and fit inside a nominal length bound. Unknown names
 * therefore collapse to `Error` rather than becoming retained log data.
 */
function safePoolErrorName(value: unknown): string {
  return typeof value === 'string' && SAFE_POOL_ERROR_NAMES.has(value)
    ? value
    : 'Error';
}

/**
 * Retains only PostgreSQL operational SQLSTATEs explicitly useful to pool health evidence.
 *
 * Five uppercase characters are merely the SQLSTATE wire shape, not proof that a value is a
 * PostgreSQL-defined condition. A hostile or corrupted peer can otherwise place arbitrary data in
 * the code field. The finite set is limited to connection exceptions, resource exhaustion,
 * operator intervention, and external system errors that can explain an idle-client failure.
 */
function safePostgresCode(value: unknown): string | null {
  return typeof value === 'string' && SAFE_POSTGRES_SQLSTATES.has(value)
    ? value
    : null;
}

/** Emits one structured pool-failure record without serializing the native database error. */
function defaultPluginPostgresPoolErrorLogger(
  record: PluginPostgresPoolErrorRecord,
): void {
  Logger.error(record, record.context);
}

/** Registers the idle-client failure boundary before a pool becomes runtime authority. */
export function registerPluginPostgresPoolErrorHandler(
  pool: NodePostgresPoolLike,
  logError: PluginPostgresPoolErrorLogger = defaultPluginPostgresPoolErrorLogger,
): void {
  pool.on('error', (error) => {
    let errorName: unknown;
    let postgresCode: unknown;
    try {
      errorName = error.name;
      postgresCode = (error as { readonly code?: unknown }).code;
    } catch {
      errorName = undefined;
      postgresCode = undefined;
    }

    const record = Object.freeze({
      message: PLUGIN_POSTGRES_POOL_ERROR_MESSAGE,
      context: 'IntegrationPluginPostgresRuntime' as const,
      errorName: safePoolErrorName(errorName),
      postgresCode: safePostgresCode(postgresCode),
    });

    try {
      logError(record);
    } catch {
      // A telemetry sink failure must not turn an already-bounded idle database error into an
      // uncaught process exception or restore native/provider detail to the process error surface.
    }
  });
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
 * invoked. Finite acquisition, idle, lifetime, and pool-size bounds are explicit because the
 * node-postgres connection-acquisition timeout otherwise defaults to no timeout. An idle-client
 * error listener is registered before the pool crosses the runtime boundary so native errors do
 * not become uncaught process failures or credential-bearing logs. Parameter arrays are copied
 * because node-postgres accepts mutable arrays while Integration repositories expose readonly
 * fixed-query values.
 */
export function createNodePostgresPluginPool(
  connectionString: string,
  PoolConstructor: NodePostgresPoolConstructor = Pool as unknown as NodePostgresPoolConstructor,
  logError: PluginPostgresPoolErrorLogger = defaultPluginPostgresPoolErrorLogger,
): PluginHostedPostgresPool {
  const pool = new PoolConstructor({
    connectionString: requireConnectionString(connectionString),
    max: PLUGIN_POSTGRES_POOL_MAX,
    connectionTimeoutMillis: PLUGIN_POSTGRES_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: PLUGIN_POSTGRES_IDLE_TIMEOUT_MS,
    maxLifetimeSeconds: PLUGIN_POSTGRES_MAX_LIFETIME_SECONDS,
  });
  registerPluginPostgresPoolErrorHandler(pool, logError);

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
