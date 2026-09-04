import { PluginInstallationApplication } from './plugin-installation';
import { PostgresPluginInstallationStore } from './plugin-installation-repository';
import { PostgresPluginCredentialBindingStore } from './plugin-credential-repository';
import { PostgresPluginOperatorReplayGuard } from './plugin-operator-replay';
import type { PluginOperatorApplication } from './plugin-operator-application';
import {
  createPluginVaultOperatorApplication,
  type PluginVaultOperatorEnvironment,
} from './plugin-vault-operator-composition';

const MAXIMUM_DATABASE_CONFIGURATION_LENGTH = 8_192;

/** Result contract shared by the Integration-owned PostgreSQL adapters. */
export interface PluginHostedPostgresResult<Row> {
  readonly rows: readonly Row[];
  readonly rowCount: number | null;
}

/**
 * Service-owned PostgreSQL pool boundary used by hosted Plugin composition.
 *
 * The interface intentionally contains only the fixed-query authority already
 * consumed by Integration repositories plus deterministic shutdown ownership.
 */
export interface PluginHostedPostgresPool {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PluginHostedPostgresResult<Row>>;
  end(): Promise<void>;
}

/** Creates the single Integration-owned PostgreSQL pool for the hosted Plugin runtime. */
export type PluginHostedPostgresPoolFactory = (
  connectionString: string,
) => PluginHostedPostgresPool | Promise<PluginHostedPostgresPool>;

/** Runtime handle registered before listener start and closed during service shutdown. */
export interface PluginVaultHostedRuntime {
  readonly operator: PluginOperatorApplication;
  close(): Promise<void>;
}

/** Fixed startup/shutdown error that never reflects database, Vault, or verifier configuration. */
export class PluginVaultHostedRuntimeError extends Error {
  /** Creates the bounded hosted-runtime failure surface. */
  constructor() {
    super('Plugin hosted runtime configuration is unavailable');
    this.name = 'PluginVaultHostedRuntimeError';
  }
}

/** Fails closed without reflecting the malformed dependency or configuration value. */
function unavailable(): never {
  throw new PluginVaultHostedRuntimeError();
}

/** Requires a bounded environment mapping before any configuration field is read. */
function requireEnvironment(value: unknown): PluginVaultOperatorEnvironment {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return unavailable();
  }
  return value as PluginVaultOperatorEnvironment;
}

/** Requires one exact Integration-owned database setting and rejects generic aliases. */
function databaseUrl(environment: PluginVaultOperatorEnvironment): string {
  let value: unknown;
  try {
    value = environment.INTEGRATION_DATABASE_URL;
  } catch {
    return unavailable();
  }
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_DATABASE_CONFIGURATION_LENGTH
  ) {
    return unavailable();
  }
  return value;
}

/** Requires stable pool behavior to satisfy all Integration-owned Plugin repositories. */
function requirePool(value: unknown): PluginHostedPostgresPool {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return unavailable();
  }

  let query: unknown;
  let end: unknown;
  try {
    query = (value as PluginHostedPostgresPool).query;
    end = (value as PluginHostedPostgresPool).end;
  } catch {
    return unavailable();
  }
  if (typeof query !== 'function' || typeof end !== 'function') {
    return unavailable();
  }

  const receiver = value as object;
  return Object.freeze({
    query<Row>(
      text: string,
      values?: readonly unknown[],
    ): Promise<PluginHostedPostgresResult<Row>> {
      return Reflect.apply(query, receiver, [text, values]) as Promise<
        PluginHostedPostgresResult<Row>
      >;
    },
    end(): Promise<void> {
      return Reflect.apply(end, receiver, []) as Promise<void>;
    },
  });
}

/** Best-effort cleanup for an acquired value before it has been accepted as a pool. */
async function closeAcquired(value: unknown): Promise<void> {
  if (value === null || typeof value !== 'object') {
    return;
  }

  let end: unknown;
  try {
    end = (value as { end?: unknown }).end;
  } catch {
    return;
  }
  if (typeof end !== 'function') {
    return;
  }
  try {
    await Reflect.apply(end, value, []);
  } catch {
    // Startup still collapses to the fixed credential-free runtime error below.
  }
}

/** Closes an accepted pool and preserves the credential-free runtime error surface. */
async function closePool(pool: PluginHostedPostgresPool): Promise<void> {
  try {
    await pool.end();
  } catch {
    return unavailable();
  }
}

/**
 * Builds the hosted Plugin authority over one service-owned PostgreSQL pool.
 *
 * `INTEGRATION_DATABASE_URL` is the only accepted persistence authority. The same
 * pool backs installation lifecycle, credential metadata, and one-time operator
 * replay evidence, preventing cross-service SQL ownership or independent pool
 * lifecycles for one bounded context. Vault/operator composition happens only
 * after the pool and all three Integration-owned adapters exist. If subsequent
 * composition fails, the newly acquired pool is closed before the fixed startup
 * failure is returned.
 *
 * Pool methods are captured once after validation rather than repeatedly read from
 * an injected object. This keeps hostile or stateful accessors from becoming later
 * SQL/shutdown authority after the resource has crossed the hosted-runtime boundary.
 *
 * The returned `close()` operation is concurrency-safe and idempotent: all callers
 * observe the same shutdown promise and the owned pool receives exactly one `end`.
 */
export async function createPluginVaultHostedRuntime(
  createPool: PluginHostedPostgresPoolFactory,
  environmentInput: PluginVaultOperatorEnvironment = process.env,
): Promise<PluginVaultHostedRuntime> {
  if (typeof createPool !== 'function') {
    return unavailable();
  }

  const environment = requireEnvironment(environmentInput);
  const connectionString = databaseUrl(environment);
  let acquired: unknown;
  try {
    acquired = await createPool(connectionString);
  } catch {
    return unavailable();
  }

  let candidate: PluginHostedPostgresPool;
  try {
    candidate = requirePool(acquired);
  } catch {
    await closeAcquired(acquired);
    return unavailable();
  }

  try {
    const installations = new PluginInstallationApplication(
      new PostgresPluginInstallationStore(candidate),
    );
    const bindingStore = new PostgresPluginCredentialBindingStore(candidate);
    const replayGuard = new PostgresPluginOperatorReplayGuard(candidate);
    const operator = createPluginVaultOperatorApplication(
      { installations, bindingStore, replayGuard },
      environment,
    );

    let shutdown: Promise<void> | undefined;
    return Object.freeze({
      operator,
      close(): Promise<void> {
        shutdown ??= closePool(candidate);
        return shutdown;
      },
    });
  } catch {
    await closeAcquired(candidate);
    return unavailable();
  }
}
