import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import { PlanningService } from './planning-domain';
import {
  type PlanningSqlClient,
  type PlanningSqlQueryResult,
  PostgresPlanningRepository,
} from './postgres-planning-repository';

const MAXIMUM_CONFIGURATION_LENGTH = 8 * 1024;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface PlanningPool {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>>;
  end(): Promise<void>;
}

export type PlanningPoolFactory = (configuration: PoolConfig) => PlanningPool;

class NodePostgresPlanningPool implements PlanningPool {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PlanningSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class NodePostgresPlanningSqlClient implements PlanningSqlClient {
  constructor(private readonly pool: PlanningPool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<PlanningSqlQueryResult<Row>> {
    return await this.pool.query<Row>(text, values);
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
  const repository = new PostgresPlanningRepository(
    new NodePostgresPlanningSqlClient(pool),
  );
  return new PlanningRuntime(pool, new PlanningService(repository));
}
