import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import { HabitService } from './habit-domain';
import {
  type HabitSqlClient,
  type HabitSqlQueryResult,
  PostgresHabitRepository,
} from './postgres-habit-repository';

const MAXIMUM_CONFIGURATION_LENGTH = 8 * 1024;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface HabitPool {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>>;
  end(): Promise<void>;
}

export type HabitPoolFactory = (configuration: PoolConfig) => HabitPool;

class NodePostgresHabitPool implements HabitPool {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<HabitSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class NodePostgresHabitSqlClient implements HabitSqlClient {
  constructor(private readonly pool: HabitPool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<HabitSqlQueryResult<Row>> {
    return await this.pool.query<Row>(text, values);
  }
}

function requireConfiguration(
  environment: RuntimeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value || value.length > MAXIMUM_CONFIGURATION_LENGTH) {
    throw new Error(`Required habit configuration is missing: ${name}`);
  }
  return value;
}

function requireDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Habit database URL is invalid');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Habit database URL must use PostgreSQL');
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

export function createHabitPoolConfiguration(
  environment: RuntimeEnvironment,
): PoolConfig {
  return {
    connectionString: requireDatabaseUrl(
      requireConfiguration(environment, 'HABIT_DATABASE_URL'),
    ),
    application_name: 'life-os-habit-service',
    max: requireBoundedInteger(
      environment.HABIT_DATABASE_POOL_MAX,
      10,
      1,
      32,
      'Habit database pool size is invalid',
    ),
    connectionTimeoutMillis: requireBoundedInteger(
      environment.HABIT_DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
      100,
      30_000,
      'Habit database connection timeout is invalid',
    ),
    idleTimeoutMillis: requireBoundedInteger(
      environment.HABIT_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      300_000,
      'Habit database idle timeout is invalid',
    ),
  };
}

function defaultPoolFactory(configuration: PoolConfig): HabitPool {
  return new NodePostgresHabitPool(new Pool(configuration));
}

export class HabitRuntime implements OnApplicationShutdown {
  private closed = false;

  constructor(
    private readonly pool: HabitPool,
    readonly service: HabitService,
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

export function createHabitRuntime(
  environment: RuntimeEnvironment = process.env,
  poolFactory: HabitPoolFactory = defaultPoolFactory,
): HabitRuntime {
  const pool = poolFactory(createHabitPoolConfiguration(environment));
  const repository = new PostgresHabitRepository(
    new NodePostgresHabitSqlClient(pool),
  );
  return new HabitRuntime(pool, new HabitService(repository));
}
