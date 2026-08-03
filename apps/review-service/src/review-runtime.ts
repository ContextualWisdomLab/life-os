import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import {
  PostgresReviewRepository,
  type ReviewSqlClient,
  type ReviewSqlQueryResult,
} from './postgres-review-repository';
import { ReviewService } from './review-domain';

const MAXIMUM_CONFIGURATION_LENGTH = 8 * 1024;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/** Minimal pool boundary used for deterministic runtime tests. */
export interface ReviewPool {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<ReviewSqlQueryResult<Row>>;
  end(): Promise<void>;
}

export type ReviewPoolFactory = (configuration: PoolConfig) => ReviewPool;

class NodePostgresReviewPool implements ReviewPool {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ReviewSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class NodePostgresReviewSqlClient implements ReviewSqlClient {
  constructor(private readonly pool: ReviewPool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ReviewSqlQueryResult<Row>> {
    return await this.pool.query<Row>(text, values);
  }
}

function requireConfiguration(
  environment: RuntimeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value || value.length > MAXIMUM_CONFIGURATION_LENGTH) {
    throw new Error(`Required review configuration is missing: ${name}`);
  }
  return value;
}

function requireDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Review database URL is invalid');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Review database URL must use PostgreSQL');
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
  if (value === undefined || value.trim() === '') return defaultValue;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(message);
  }
  return parsed;
}

/** Builds a bounded, service-specific PostgreSQL pool configuration. */
export function createReviewPoolConfiguration(
  environment: RuntimeEnvironment,
): PoolConfig {
  return {
    connectionString: requireDatabaseUrl(
      requireConfiguration(environment, 'REVIEW_DATABASE_URL'),
    ),
    application_name: 'life-os-review-service',
    max: requireBoundedInteger(
      environment.REVIEW_DATABASE_POOL_MAX,
      10,
      1,
      32,
      'Review database pool size is invalid',
    ),
    connectionTimeoutMillis: requireBoundedInteger(
      environment.REVIEW_DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
      100,
      30_000,
      'Review database connection timeout is invalid',
    ),
    idleTimeoutMillis: requireBoundedInteger(
      environment.REVIEW_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      300_000,
      'Review database idle timeout is invalid',
    ),
  };
}

function defaultPoolFactory(configuration: PoolConfig): ReviewPool {
  return new NodePostgresReviewPool(new Pool(configuration));
}

/** Owns the review database pool and closes it exactly once. */
export class ReviewRuntime implements OnApplicationShutdown {
  private closed = false;

  constructor(
    private readonly pool: ReviewPool,
    readonly service: ReviewService,
  ) {}

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}

/** Creates the production guided-review runtime. */
export function createReviewRuntime(
  environment: RuntimeEnvironment = process.env,
  poolFactory: ReviewPoolFactory = defaultPoolFactory,
): ReviewRuntime {
  const pool = poolFactory(createReviewPoolConfiguration(environment));
  const repository = new PostgresReviewRepository(
    new NodePostgresReviewSqlClient(pool),
  );
  return new ReviewRuntime(pool, new ReviewService(repository));
}
