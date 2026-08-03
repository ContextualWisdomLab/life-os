import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { OAuthTransactionService, SessionService } from './auth-security';
import { GitHubOAuthClient } from './github-oauth-client';
import { GoogleOidcClient } from './google-oidc-client';
import { IdentityService } from './identity-domain';
import {
  OAuthCallbackApplication,
  type OAuthCallbackAuditEvent,
  type OAuthCallbackAuditSink,
} from './oauth-callback-application';
import { OAuthHttpApplication } from './oauth-http-application';
import {
  PostgresIdentityRepository,
  type SqlTransaction,
  type TransactionalSqlClient,
} from './postgres-identity-repository';
import {
  PostgresOAuthTransactionRepository,
  PostgresSessionRepository,
  type SqlQueryResult,
} from './postgres-security-repositories';
import { AesGcmSecretBox } from './secret-box';

const MAXIMUM_CONFIGURATION_LENGTH = 8 * 1024;
const MAXIMUM_KEY_VERSIONS = 8;
const KEY_VERSION_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,31}$/;
const ENCODED_KEY_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/;

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

class NodePostgresSqlTransaction implements SqlTransaction {
  constructor(private readonly client: PoolClient) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.client.query(text, [...values]);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount,
    };
  }

  release(): void {
    this.client.release();
  }
}

class NodePostgresSqlClient implements TransactionalSqlClient {
  constructor(private readonly pool: Pool) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const result = await this.pool.query(text, [...values]);
    return {
      rows: result.rows as Row[],
      rowCount: result.rowCount,
    };
  }

  async connect(): Promise<SqlTransaction> {
    return new NodePostgresSqlTransaction(await this.pool.connect());
  }
}

class StructuredOAuthCallbackAuditSink implements OAuthCallbackAuditSink {
  record(event: OAuthCallbackAuditEvent): void {
    process.stdout.write(
      `${JSON.stringify({ eventType: 'oauth_callback', ...event })}\n`,
    );
  }
}

function requireConfiguration(
  environment: RuntimeEnvironment,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value || value.length > MAXIMUM_CONFIGURATION_LENGTH) {
    throw new Error(`Required identity configuration is missing: ${name}`);
  }
  return value;
}

function requireDatabaseUrl(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('Identity database URL must use PostgreSQL');
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

function decodeSecretKey(encoded: unknown): Buffer {
  if (
    typeof encoded !== 'string' ||
    !ENCODED_KEY_PATTERN.test(encoded) ||
    encoded.length > 128
  ) {
    throw new Error('OAuth encryption keys are invalid');
  }
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error('OAuth encryption keys must decode to 32 bytes');
  }
  return key;
}

function parseSecretKeys(value: string): Readonly<Record<string, Buffer>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error('OAuth encryption key configuration is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OAuth encryption key configuration is invalid');
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > MAXIMUM_KEY_VERSIONS) {
    throw new Error('OAuth encryption key configuration is invalid');
  }
  return Object.freeze(
    Object.fromEntries(
      entries.map(([version, encoded]) => {
        if (!KEY_VERSION_PATTERN.test(version)) {
          throw new Error('OAuth encryption key version is invalid');
        }
        return [version, decodeSecretKey(encoded)];
      }),
    ),
  );
}

function createPoolConfiguration(environment: RuntimeEnvironment): PoolConfig {
  return {
    connectionString: requireDatabaseUrl(
      requireConfiguration(environment, 'IDENTITY_DATABASE_URL'),
    ),
    application_name: 'life-os-identity-service',
    max: requireBoundedInteger(
      environment.IDENTITY_DATABASE_POOL_MAX,
      10,
      1,
      32,
      'Identity database pool size is invalid',
    ),
    connectionTimeoutMillis: requireBoundedInteger(
      environment.IDENTITY_DATABASE_CONNECT_TIMEOUT_MS,
      5_000,
      100,
      30_000,
      'Identity database connection timeout is invalid',
    ),
    idleTimeoutMillis: requireBoundedInteger(
      environment.IDENTITY_DATABASE_IDLE_TIMEOUT_MS,
      30_000,
      1_000,
      300_000,
      'Identity database idle timeout is invalid',
    ),
  };
}

export class IdentityRuntime implements OnApplicationShutdown {
  private closed = false;

  constructor(
    private readonly pool: Pool,
    readonly application: OAuthHttpApplication,
    readonly callbackApplication: OAuthCallbackApplication,
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

export function createIdentityRuntime(
  environment: RuntimeEnvironment = process.env,
): IdentityRuntime {
  const currentKeyVersion = requireConfiguration(
    environment,
    'IDENTITY_OAUTH_KEY_VERSION',
  );
  if (!KEY_VERSION_PATTERN.test(currentKeyVersion)) {
    throw new Error('OAuth encryption key version is invalid');
  }
  const keys = parseSecretKeys(
    requireConfiguration(environment, 'IDENTITY_OAUTH_KEYS'),
  );
  const secretBox = new AesGcmSecretBox({
    currentKeyVersion,
    keys,
  });
  const pool = new Pool(createPoolConfiguration(environment));
  const sqlClient = new NodePostgresSqlClient(pool);
  const transactions = new OAuthTransactionService(
    new PostgresOAuthTransactionRepository(sqlClient, secretBox),
  );
  const sessions = new SessionService(new PostgresSessionRepository(sqlClient));
  const identities = new IdentityService(
    new PostgresIdentityRepository(sqlClient),
  );
  const webOrigin = requireConfiguration(environment, 'LIFE_OS_WEB_ORIGIN');
  const googleRedirectUri = requireConfiguration(
    environment,
    'IDENTITY_GOOGLE_REDIRECT_URI',
  );
  const githubRedirectUri = requireConfiguration(
    environment,
    'IDENTITY_GITHUB_REDIRECT_URI',
  );
  const application = new OAuthHttpApplication(transactions, sessions, {
    providers: {
      google: {
        clientId: requireConfiguration(
          environment,
          'IDENTITY_GOOGLE_CLIENT_ID',
        ),
        redirectUri: googleRedirectUri,
      },
      github: {
        clientId: requireConfiguration(
          environment,
          'IDENTITY_GITHUB_CLIENT_ID',
        ),
        redirectUri: githubRedirectUri,
      },
    },
    webOrigin,
  });
  const callbackApplication = new OAuthCallbackApplication(
    transactions,
    identities,
    sessions,
    {
      google: new GoogleOidcClient({
        clientId: requireConfiguration(
          environment,
          'IDENTITY_GOOGLE_CLIENT_ID',
        ),
        clientSecret: requireConfiguration(
          environment,
          'IDENTITY_GOOGLE_CLIENT_SECRET',
        ),
        redirectUri: googleRedirectUri,
      }),
      github: new GitHubOAuthClient({
        clientId: requireConfiguration(
          environment,
          'IDENTITY_GITHUB_CLIENT_ID',
        ),
        clientSecret: requireConfiguration(
          environment,
          'IDENTITY_GITHUB_CLIENT_SECRET',
        ),
        redirectUri: githubRedirectUri,
      }),
    },
    new StructuredOAuthCallbackAuditSink(),
    { webOrigin },
  );
  return new IdentityRuntime(pool, application, callbackApplication);
}
