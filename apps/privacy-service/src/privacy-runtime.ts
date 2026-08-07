import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolConfig, type PoolClient } from 'pg';
import { PrivacyAccessApplication } from './privacy-access-application';
import {
  PostgresPrivacyAccessRepository,
  type PrivacySqlPool,
  type PrivacySqlQueryResult,
  type PrivacySqlTransactionClient,
} from './postgres-privacy-access-repository';
import {
  parsePrivacyGrantKeyRing,
  type PrivacyGrantKeyEnvironment,
} from './privacy-access-token';
import {
  parsePrivacyServiceContextKeyRing,
  type PrivacyServiceContextKeyEnvironment,
  type PrivacyServiceContextKeyRing,
} from './privacy-service-context';

const MAXIMUM_CONFIGURATION_LENGTH = 8 * 1024;
const MINIMUM_DIGEST_KEY_BYTES = 32;
const MAXIMUM_DIGEST_KEY_BYTES = 4_096;
const DISALLOWED_CONTROL_PATTERN = /[\r\n\u0000]/u;

/** Complete environment required by the privacy service composition root. */
export type PrivacyRuntimeEnvironment = Readonly<
  Record<string, string | undefined>
> &
  PrivacyGrantKeyEnvironment &
  PrivacyServiceContextKeyEnvironment;

/** PostgreSQL pool surface used by the runtime and shutdown tests. */
export interface PrivacyPool extends PrivacySqlPool {
  /** Registers one process-level pool error listener. */
  on(event: 'error', listener: (error: Error) => void): void;
  /** Closes all checked-out and idle connections. */
  end(): Promise<void>;
}

/** Factory seam used to create one production or test pool. */
export type PrivacyPoolFactory = (configuration: PoolConfig) => PrivacyPool;

class NodePrivacyTransactionClient implements PrivacySqlTransactionClient {
  constructor(private readonly client: PoolClient) {}

  async query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PrivacySqlQueryResult<Row>> {
    const result = await this.client.query<Row>(
      text,
      values === undefined ? undefined : [...values],
    );
    return { rows: result.rows };
  }

  release(): void {
    this.client.release();
  }
}

class NodePrivacyPool implements PrivacyPool {
  constructor(private readonly pool: Pool) {}

  async connect(): Promise<PrivacySqlTransactionClient> {
    return new NodePrivacyTransactionClient(await this.pool.connect());
  }

  on(event: 'error', listener: (error: Error) => void): void {
    this.pool.on(event, listener);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

function invalid(): never {
  throw new Error('Privacy database configuration is invalid');
}

function requireConfiguration(
  environment: PrivacyRuntimeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (
    !value ||
    value.length > MAXIMUM_CONFIGURATION_LENGTH ||
    DISALLOWED_CONTROL_PATTERN.test(value)
  ) {
    return invalid();
  }
  return value;
}

function requireDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalid();
  }
  return parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:'
    ? value
    : invalid();
}

function requireBoundedInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : invalid();
}

function requireDigestKey(value: string): string {
  const bytes = Buffer.byteLength(value, 'utf8');
  return bytes >= MINIMUM_DIGEST_KEY_BYTES &&
    bytes <= MAXIMUM_DIGEST_KEY_BYTES &&
    !DISALLOWED_CONTROL_PATTERN.test(value)
    ? value
    : invalid();
}

/** Builds one bounded PostgreSQL pool configuration from environment values. */
export function createPrivacyPoolConfiguration(
  environment: PrivacyRuntimeEnvironment,
): PoolConfig {
  return {
    connectionString: requireDatabaseUrl(
      requireConfiguration(environment, 'PRIVACY_DATABASE_URL'),
    ),
    application_name: 'life-os-privacy-service',
    max: requireBoundedInteger(
      environment.PRIVACY_DATABASE_POOL_MAX,
      10,
      1,
      32,
    ),
    connectionTimeoutMillis: requireBoundedInteger(
      environment.PRIVACY_DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
      100,
      30_000,
    ),
    idleTimeoutMillis: requireBoundedInteger(
      environment.PRIVACY_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      300_000,
    ),
  };
}

function defaultPoolFactory(configuration: PoolConfig): PrivacyPool {
  return new NodePrivacyPool(new Pool(configuration));
}

/** Runtime-owned application, private-context keys, and exactly-once shutdown. */
export class PrivacyRuntime implements OnApplicationShutdown {
  private closeOperation: Promise<void> | undefined;

  /** Creates one immutable composition over a single PostgreSQL pool. */
  constructor(
    private readonly pool: PrivacyPool,
    readonly application: PrivacyAccessApplication,
    readonly contextKeyRing: PrivacyServiceContextKeyRing,
  ) {}

  /** Returns one shared pool-shutdown operation to every caller. */
  close(): Promise<void> {
    this.closeOperation ??= this.pool.end();
    return this.closeOperation;
  }

  /** Integrates exactly-once pool shutdown with the Nest lifecycle. */
  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}

/** Creates the production privacy runtime after validating every secret first. */
export function createPrivacyRuntime(
  environment: PrivacyRuntimeEnvironment = process.env,
  poolFactory: PrivacyPoolFactory = defaultPoolFactory,
): PrivacyRuntime {
  const grantKeyRing = parsePrivacyGrantKeyRing(environment);
  const contextKeyRing = parsePrivacyServiceContextKeyRing(environment);
  const auditDigestKey = requireDigestKey(
    requireConfiguration(environment, 'PRIVACY_AUDIT_DIGEST_KEY'),
  );
  const pool = poolFactory(createPrivacyPoolConfiguration(environment));
  pool.on('error', () => {
    // Detailed pool errors stay inside the process boundary; request paths map
    // repository failures to credential-free problem details.
  });
  const repository = new PostgresPrivacyAccessRepository(pool);
  const application = new PrivacyAccessApplication({
    repository,
    grantKeyRing,
    auditDigestKey,
  });
  return new PrivacyRuntime(pool, application, contextKeyRing);
}
