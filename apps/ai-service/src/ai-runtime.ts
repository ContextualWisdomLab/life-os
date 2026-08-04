import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolConfig } from 'pg';
import { ProposalAuditApplication } from './proposal-audit-application';
import {
  type ProposalAuditSqlClient,
  type ProposalAuditSqlQueryResult,
  PostgresProposalAuditRepository,
} from './postgres-proposal-audit-repository';
import { ProposalService, RuleBasedProposalModel } from './proposal-service';

const MAXIMUM_CONFIGURATION_LENGTH = 8 * 1024;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/** Bounded PostgreSQL pool boundary used by the AI production runtime. */
export interface AiPool {
  query<Row>(
    text: string,
    values?: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>>;
  end(): Promise<void>;
}

export type AiPoolFactory = (configuration: PoolConfig) => AiPool;

class NodePostgresAiPool implements AiPool {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return { rows: result.rows as Row[] };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

class NodePostgresProposalAuditSqlClient implements ProposalAuditSqlClient {
  constructor(private readonly pool: AiPool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[],
  ): Promise<ProposalAuditSqlQueryResult<Row>> {
    return await this.pool.query<Row>(text, values);
  }
}

function requireConfiguration(
  environment: RuntimeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value || value.length > MAXIMUM_CONFIGURATION_LENGTH) {
    throw new Error(`Required AI configuration is missing: ${name}`);
  }
  return value;
}

function requireDatabaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('AI database URL is invalid');
  }
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('AI database URL must use PostgreSQL');
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

/** Creates the bounded node-postgres configuration for the AI audit runtime. */
export function createAiPoolConfiguration(
  environment: RuntimeEnvironment,
): PoolConfig {
  return {
    connectionString: requireDatabaseUrl(
      requireConfiguration(environment, 'AI_DATABASE_URL'),
    ),
    application_name: 'life-os-ai-service',
    max: requireBoundedInteger(
      environment.AI_DATABASE_POOL_MAX,
      10,
      1,
      32,
      'AI database pool size is invalid',
    ),
    connectionTimeoutMillis: requireBoundedInteger(
      environment.AI_DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
      100,
      30_000,
      'AI database connection timeout is invalid',
    ),
    idleTimeoutMillis: requireBoundedInteger(
      environment.AI_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      300_000,
      'AI database idle timeout is invalid',
    ),
  };
}

function defaultPoolFactory(configuration: PoolConfig): AiPool {
  return new NodePostgresAiPool(new Pool(configuration));
}

/** Owns the production audit pool and closes it exactly once. */
export class AiRuntime implements OnApplicationShutdown {
  private closed = false;

  constructor(
    private readonly pool: AiPool,
    readonly application: ProposalAuditApplication,
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

/** Wires the production rule-based proposal model to append-only PostgreSQL audit. */
export function createAiRuntime(
  environment: RuntimeEnvironment = process.env,
  poolFactory: AiPoolFactory = defaultPoolFactory,
): AiRuntime {
  const pool = poolFactory(createAiPoolConfiguration(environment));
  const repository = new PostgresProposalAuditRepository(
    new NodePostgresProposalAuditSqlClient(pool),
  );
  const proposalService = new ProposalService(new RuleBasedProposalModel());
  return new AiRuntime(
    pool,
    new ProposalAuditApplication(proposalService, repository, 'rule-based-v1'),
  );
}
