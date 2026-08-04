import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import {
  PostgresInAppDeliveryGateway,
  PostgresReminderRepository,
  type NotificationSqlClient,
  type NotificationSqlQueryResult,
} from './postgres-reminder-repository';
import { ReminderScheduler } from './reminder-scheduler';

const MAXIMUM_CONFIGURATION_LENGTH = 8 * 1024;
const DEFAULT_CLAIM_LEASE_SECONDS = 300;
const DEFAULT_REMINDER_BATCH_SIZE = 50;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/** Minimal event boundary needed to observe idle PostgreSQL client failures. */
export interface NotificationPoolErrorSource {
  /** Subscribes to unexpected idle-client failures emitted by the pool. */
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** Credential-free error logger used by the pool error boundary. */
export type NotificationPoolErrorLogger = (
  message: string,
  context: string,
) => void;

const NOTIFICATION_POOL_ERROR_MESSAGE =
  'Notification PostgreSQL pool reported an idle client error';

/** Emits one fixed error record without serializing the database error. */
function defaultNotificationPoolErrorLogger(
  message: string,
  context: string,
): void {
  Logger.error(message, context);
}

/** Registers a sanitized listener before the PostgreSQL pool can be used. */
export function registerNotificationPoolErrorHandler(
  pool: NotificationPoolErrorSource,
  logError: NotificationPoolErrorLogger = defaultNotificationPoolErrorLogger,
): void {
  pool.on('error', () => {
    logError(NOTIFICATION_POOL_ERROR_MESSAGE, 'NotificationRuntime');
  });
}

/** PostgreSQL pool boundary owned by the notification service runtime. */
export interface NotificationPool {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>>;
  end(): Promise<void>;
}

/** Factory boundary used to construct one validated notification pool. */
export type NotificationPoolFactory = (
  configuration: PoolConfig,
) => NotificationPool;

class NodePostgresNotificationPool implements NotificationPool {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<NotificationSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class NodePostgresNotificationSqlClient implements NotificationSqlClient {
  constructor(private readonly pool: NotificationPool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<NotificationSqlQueryResult<Row>> {
    return await this.pool.query<Row>(text, values);
  }
}

function requireConfiguration(
  environment: RuntimeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value || value.length > MAXIMUM_CONFIGURATION_LENGTH) {
    throw new Error(`Required notification configuration is missing: ${name}`);
  }
  return value;
}

function requireDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Notification database URL is invalid');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Notification database URL must use PostgreSQL');
  }
  return value;
}

function requireBoundedInteger(
  value: string | undefined,
  defaultValue: number,
  minimum: number,
  maximum: number,
  message: string,
): number {
  if (value === undefined || value.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(message);
  }
  return parsed;
}

/** Builds bounded node-postgres configuration for the notification service. */
export function createNotificationPoolConfiguration(
  environment: RuntimeEnvironment,
): PoolConfig {
  return {
    connectionString: requireDatabaseUrl(
      requireConfiguration(environment, 'NOTIFICATION_DATABASE_URL'),
    ),
    application_name: 'life-os-notification-service',
    max: requireBoundedInteger(
      environment.NOTIFICATION_DATABASE_POOL_MAX,
      10,
      1,
      32,
      'Notification database pool size is invalid',
    ),
    connectionTimeoutMillis: requireBoundedInteger(
      environment.NOTIFICATION_DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
      100,
      30_000,
      'Notification database connection timeout is invalid',
    ),
    idleTimeoutMillis: requireBoundedInteger(
      environment.NOTIFICATION_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      300_000,
      'Notification database idle timeout is invalid',
    ),
  };
}

function defaultPoolFactory(configuration: PoolConfig): NotificationPool {
  const pool = new Pool(configuration);
  registerNotificationPoolErrorHandler(pool);
  return new NodePostgresNotificationPool(pool);
}

/** Owns one pool and the composed durable notification scheduler. */
export class NotificationRuntime implements OnApplicationShutdown {
  private closed = false;

  constructor(
    private readonly pool: NotificationPool,
    readonly repository: PostgresReminderRepository,
    readonly gateway: PostgresInAppDeliveryGateway,
    readonly scheduler: ReminderScheduler,
  ) {}

  /** Closes the owned PostgreSQL pool exactly once. */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.pool.end();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}

/** Constructs the production notification runtime from validated environment data. */
export function createNotificationRuntime(
  environment: RuntimeEnvironment = process.env,
  poolFactory: NotificationPoolFactory = defaultPoolFactory,
): NotificationRuntime {
  const configuration = createNotificationPoolConfiguration(environment);
  const claimLeaseSeconds = requireBoundedInteger(
    environment.NOTIFICATION_CLAIM_LEASE_SECONDS,
    DEFAULT_CLAIM_LEASE_SECONDS,
    30,
    3_600,
    'Notification claim lease is invalid',
  );
  const reminderBatchSize = requireBoundedInteger(
    environment.NOTIFICATION_REMINDER_BATCH_SIZE,
    DEFAULT_REMINDER_BATCH_SIZE,
    1,
    100,
    'Notification reminder batch size is invalid',
  );
  const pool = poolFactory(configuration);
  const client = new NodePostgresNotificationSqlClient(pool);
  const repository = new PostgresReminderRepository(client, claimLeaseSeconds);
  const gateway = new PostgresInAppDeliveryGateway(client);
  const scheduler = new ReminderScheduler(
    repository,
    gateway,
    reminderBatchSize,
  );
  return new NotificationRuntime(pool, repository, gateway, scheduler);
}
