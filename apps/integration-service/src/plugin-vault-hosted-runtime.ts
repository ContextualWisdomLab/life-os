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

/** Requires one exact Integration-owned database setting and rejects generic aliases. */
function databaseUrl(environment: PluginVaultOperatorEnvironment): string {
  const value = environment.INTEGRATION_DATABASE_URL;
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAXIMUM_DATABASE_CONFIGURATION_LENGTH
  ) {
    return unavailable();
  }
  return value;
}

/** Requires enough pool behavior to satisfy all Integration-owned Plugin repositories. */
function requirePool(value: unknown): PluginHostedPostgresPool {
  if (
    value === null ||
    typeof value !== 'object' ||
    typeof (value as PluginHostedPostgresPool).query !== 'function' ||
    typeof (value as PluginHostedPostgresPool).end !== 'function'
  ) {
    return unavailable();
  }
  return value as PluginHostedPostgresPool;
}

/** Closes an acquired pool and preserves the credential-free runtime error surface. */
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
 * The returned `close()` operation is concurrency-safe and idempotent: all callers
 * observe the same shutdown promise and the owned pool receives exactly one `end`.
 */
export async function createPluginVaultHostedRuntime(
  createPool: PluginHostedPostgresPoolFactory,
  environment: PluginVaultOperatorEnvironment = process.env,
): Promise<PluginVaultHostedRuntime> {
  if (typeof createPool !== 'function') {
    return unavailable();
  }

  const connectionString = databaseUrl(environment);
  let candidate: PluginHostedPostgresPool;
  try {
    candidate = requirePool(await createPool(connectionString));
  } catch {
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
    try {
      await candidate.end();
    } catch {
      // Startup remains one credential-free failure even when cleanup also fails.
    }
    return unavailable();
  }
}
