import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { PlanningDataRightsContributor } from './planning-data-rights';
import { PlanningService } from './planning-domain';
import {
  type PlanningSqlClient,
  type PlanningSqlQueryResult,
  PostgresPlanningRepository,
} from './postgres-planning-repository';
import {
  PostgresTodayRepository,
  type TodayTransactionalSqlClient,
} from './postgres-today-repository';
import { TodaySyncService } from './today-sync';

const MAXIMUM_CONFIGURATION_LENGTH = 8 * 1024;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface PlanningPoolConnection {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>>;
  release(destroy?: boolean): void;
}

export interface PlanningPool {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>>;
  connect(): Promise<PlanningPoolConnection>;
  end(): Promise<void>;
}

export type PlanningPoolFactory = (configuration: PoolConfig) => PlanningPool;

class NodePostgresPlanningPoolConnection implements PlanningPoolConnection {
  constructor(private readonly client: PoolClient) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PlanningSqlQueryResult<Row>> {
    const result = await this.client.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }

  release(destroy = false): void {
    this.client.release(destroy);
  }
}

class NodePostgresPlanningPool implements PlanningPool {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PlanningSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }

  async connect(): Promise<PlanningPoolConnection> {
    return new NodePostgresPlanningPoolConnection(await this.pool.connect());
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class ConnectionSqlClient implements PlanningSqlClient {
  constructor(private readonly connection: PlanningPoolConnection) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    return await this.connection.query<Row>(text, values);
  }
}

class NodePostgresPlanningSqlClient implements TodayTransactionalSqlClient {
  constructor(private readonly pool: PlanningPool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    return await this.pool.query<Row>(text, values);
  }

  async transaction<Result>(
    operation: (client: PlanningSqlClient) => Promise<Result>,
  ): Promise<Result> {
    const connection = await this.pool.connect();
    let destroyConnection = false;
    try {
      await connection.query('BEGIN');
      const result = await operation(new ConnectionSqlClient(connection));
      await connection.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await connection.query('ROLLBACK');
      } catch {
        destroyConnection = true;
      }
      throw error;
    } finally {
      connection.release(destroyConnection);
    }
  }
}

function requireConfiguration(
  environment: RuntimeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value || value.length > MAXIMUM_CONFIGURATION_LENGTH) {
    throw new Error(`Required planning configuration is missing: ${name}`);
  }
  return value;
}

function requireDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Planning database URL is invalid');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Planning database URL must use PostgreSQL');
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

export function createPlanningPoolConfiguration(
  environment: RuntimeEnvironment,
): PoolConfig {
  return {
    connectionString: requireDatabaseUrl(
      requireConfiguration(environment, 'PLANNING_DATABASE_URL'),
    ),
    application_name: 'life-os-planning-service',
    max: requireBoundedInteger(
      environment.PLANNING_DATABASE_POOL_MAX,
      10,
      1,
      32,
      'Planning database pool size is invalid',
    ),
    connectionTimeoutMillis: requireBoundedInteger(
      environment.PLANNING_DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
      100,
      30_000,
      'Planning database connection timeout is invalid',
    ),
    idleTimeoutMillis: requireBoundedInteger(
      environment.PLANNING_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      300_000,
      'Planning database idle timeout is invalid',
    ),
  };
}

function defaultPoolFactory(configuration: PoolConfig): PlanningPool {
  return new NodePostgresPlanningPool(new Pool(configuration));
}

export class PlanningRuntime implements OnApplicationShutdown {
  private closed = false;

  constructor(
    private readonly pool: PlanningPool,
    readonly service: PlanningService,
    readonly todayService: TodaySyncService,
    /** Handles Planning-owned data-rights requests through the runtime's shared transactional SQL client. */
    readonly dataRightsContributor: PlanningDataRightsContributor,
  ) {}

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

export function createPlanningRuntime(
  environment: RuntimeEnvironment = process.env,
  poolFactory: PlanningPoolFactory = defaultPoolFactory,
): PlanningRuntime {
  const pool = poolFactory(createPlanningPoolConfiguration(environment));
  const client = new NodePostgresPlanningSqlClient(pool);
  const repository = new PostgresPlanningRepository(client);
  const todayRepository = new PostgresTodayRepository(client);
  return new PlanningRuntime(
    pool,
    new PlanningService(repository),
    new TodaySyncService(todayRepository),
    new PlanningDataRightsContributor(client),
  );
}
