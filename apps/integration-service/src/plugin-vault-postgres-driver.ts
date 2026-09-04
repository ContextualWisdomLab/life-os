import { Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type {
  PluginHostedPostgresPool,
  PluginHostedPostgresResult,
} from './plugin-vault-hosted-runtime';

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const PLUGIN_POSTGRES_POOL_MAX = 10;
const PLUGIN_POSTGRES_CONNECTION_TIMEOUT_MS = 5_000;
const PLUGIN_POSTGRES_STATEMENT_TIMEOUT_MS = 5_000;
const PLUGIN_POSTGRES_QUERY_TIMEOUT_MS = 6_000;
const PLUGIN_POSTGRES_IDLE_TIMEOUT_MS = 30_000;
const PLUGIN_POSTGRES_MAX_LIFETIME_SECONDS = 300;
const PLUGIN_POSTGRES_READINESS_SQL =
  'SELECT 1 AS integration_plugin_runtime_ready';
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
  readonly ssl: Readonly<{ readonly rejectUnauthorized: true }>;
  readonly max: number;
  readonly connectionTimeoutMillis: number;
  readonly statement_timeout: number;
  readonly query_timeout: number;
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

interface PluginPostgresReadinessRow {
  readonly integration_plugin_runtime_ready?: unknown;
}

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
 * Discards a constructed pool that cannot satisfy the mandatory acquisition contract.
 *
 * Listener registration and the initial readiness probe are both part of acquisition. Cleanup is
 * awaited before the fixed configuration failure is returned, while cleanup detail is consumed so
 * a driver or injected seam cannot reflect connection material through the startup error surface.
 */
async function rejectAcquiredPool(pool: NodePostgresPoolLike): Promise<never> {
  try {
    await pool.end();
  } catch {
    // The acquisition failure remains the authoritative bounded startup failure.
  }
  return unavailable();
}

/** Captures the accepted query capability once so later accessors cannot replace SQL authority. */
function capturePoolQuery(pool: NodePostgresPoolLike): NodePostgresPoolLike['query'] {
  let query: NodePostgresPoolLike['query'];
  try {
    query = pool.query;
  } catch {
    return unavailable();
  }
  if (typeof query !== 'function') {
    return unavailable();
  }

  const receiver = pool as object;
  return function capturedQuery<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }> {
    return Reflect.apply(query, receiver, [text, values]) as Promise<{
      readonly rows: readonly Row[];
      readonly rowCount: number | null;
    }>;
  };
}

/** Accepts only the exact one-row result emitted by the fixed readiness statement. */
function hasCanonicalReadinessEvidence(value: unknown): boolean {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const rows = (value as { readonly rows?: unknown }).rows;
    const rowCount = (value as { readonly rowCount?: unknown }).rowCount;
    if (!Array.isArray(rows) || rows.length !== 1 || rowCount !== 1) {
      return false;
    }

    const row = rows[0];
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      return false;
    }

    return (
      (row as PluginPostgresReadinessRow).integration_plugin_runtime_ready === 1
    );
  } catch {
    return false;
  }
}

/**
 * Proves PostgreSQL authentication, verified TLS, and query execution before listener authority.
 *
 * node-postgres pools are lazy: constructing a Pool alone does not establish a database connection.
 * The hosted runtime therefore cannot treat construction as durable acceptance. This fixed query is
 * executed only after the idle-error handler is installed, and any query/result/cleanup failure is
 * collapsed to the credential-free acquisition error before the pool can reach service adapters.
 */
async function requirePluginPostgresReadiness(
  pool: NodePostgresPoolLike,
  query: NodePostgresPoolLike['query'],
): Promise<void> {
  let result: unknown;
  try {
    result = await query<PluginPostgresReadinessRow>(
      PLUGIN_POSTGRES_READINESS_SQL,
    );
  } catch {
    return rejectAcquiredPool(pool);
  }

  if (!hasCanonicalReadinessEvidence(result)) {
    return rejectAcquiredPool(pool);
  }
}

/**
 * Requires one self-contained PostgreSQL URI before node-postgres sees process state.
 *
 * node-postgres documents that missing connection fields can be supplied by libpq-style
 * `PG*` environment variables and that connection-string query parameters can change
 * transport behavior. Requiring scheme, user, password, host, port, and database while
 * rejecting every query parameter keeps the Integration service's database target,
 * credential, and transport authority on one canonical configuration surface. TLS is
 * configured separately by the Pool with certificate verification enabled, so the URI
 * cannot disable or replace the deployment transport policy.
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
 * invoked. TLS is mandatory with peer verification through Node's configured trust store; because
 * connection-string query options are rejected, URI input cannot downgrade or replace this `ssl`
 * policy. Connection acquisition and database work are both finite: PostgreSQL receives a five-
 * second `statement_timeout`, while node-postgres retains a six-second `query_timeout` fallback so
 * the server-side cancellation has a bounded interval to arrive before the client call fails closed.
 * Idle, lifetime, and pool-size bounds are explicit as well. Pool construction itself is part of the
 * credential boundary: a constructor failure is reduced to the same fixed configuration error before
 * native driver detail can become startup evidence. The accepted query method is captured once before
 * readiness so a stateful or hostile accessor cannot pass the probe and later replace SQL authority.
 * An idle-client error listener is registered before the first query, then a fixed readiness statement
 * must prove authenticated, verified-TLS query execution before the pool crosses the runtime boundary.
 * Registration/readiness failure closes the newly constructed pool before returning the bounded
 * configuration error. Parameter arrays are copied because node-postgres accepts mutable arrays while
 * Integration repositories expose readonly fixed-query values.
 */
export function createNodePostgresPluginPool(
  connectionString: string,
  PoolConstructor: NodePostgresPoolConstructor = Pool as unknown as NodePostgresPoolConstructor,
  logError: PluginPostgresPoolErrorLogger = defaultPluginPostgresPoolErrorLogger,
): PluginHostedPostgresPool | Promise<PluginHostedPostgresPool> {
  let pool: NodePostgresPoolLike;
  try {
    pool = new PoolConstructor({
      connectionString: requireConnectionString(connectionString),
      ssl: { rejectUnauthorized: true },
      max: PLUGIN_POSTGRES_POOL_MAX,
      connectionTimeoutMillis: PLUGIN_POSTGRES_CONNECTION_TIMEOUT_MS,
      statement_timeout: PLUGIN_POSTGRES_STATEMENT_TIMEOUT_MS,
      query_timeout: PLUGIN_POSTGRES_QUERY_TIMEOUT_MS,
      idleTimeoutMillis: PLUGIN_POSTGRES_IDLE_TIMEOUT_MS,
      maxLifetimeSeconds: PLUGIN_POSTGRES_MAX_LIFETIME_SECONDS,
    });
  } catch {
    return unavailable();
  }

  let query: NodePostgresPoolLike['query'];
  try {
    query = capturePoolQuery(pool);
  } catch {
    return rejectAcquiredPool(pool);
  }

  try {
    registerPluginPostgresPoolErrorHandler(pool, logError);
  } catch {
    return rejectAcquiredPool(pool);
  }

  return requirePluginPostgresReadiness(pool, query).then(() =>
    Object.freeze({
      async query<Row>(
        text: string,
        values: readonly unknown[] = [],
      ): Promise<PluginHostedPostgresResult<Row>> {
        const result = await query<Row>(text, [...values]);
        return Object.freeze({
          rows: result.rows,
          rowCount: result.rowCount,
        });
      },
      async end(): Promise<void> {
        await pool.end();
      },
    }),
  );
}
