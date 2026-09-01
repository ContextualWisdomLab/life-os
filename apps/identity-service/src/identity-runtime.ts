import type { OnApplicationShutdown } from '@nestjs/common';
import { Pool, type PoolClient, type PoolConfig } from 'pg';
import { OAuthTransactionService, SessionService } from './auth-security';
import { PostgresDataRightsRequestLedger } from './data-rights-request-ledger';
import { AuthenticatedDataRightsStatusApplication } from './data-rights-status-application';
import { GitHubOAuthClient } from './github-oauth-client';
import { GoogleOidcClient } from './google-oidc-client';
import { IdentityService } from './identity-domain';
import {
  OAuthCallbackApplication,
  type OAuthCallbackAuditEvent,
  type OAuthCallbackAuditSink,
} from './oauth-callback-application';
import { OAuthHttpApplication } from './oauth-http-application';
import { BoundedOAuthProviderHttpClient } from './oauth-provider-http-client';
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
export type OAuthCallbackAuditWriter = (
  auditLine: string,
) => void | Promise<void>;

class NodePostgresSqlTransaction implements SqlTransaction {
  constructor(private readonly databaseClient: PoolClient) {}

  async query<Row>(
    queryText: string,
    queryValues: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const queryResult = await this.databaseClient.query(queryText, [...queryValues]);
    return {
      rows: queryResult.rows as Row[],
      rowCount: queryResult.rowCount,
    };
  }

  release(): void {
    this.databaseClient.release();
  }
}

class NodePostgresSqlClient implements TransactionalSqlClient {
  constructor(private readonly databasePool: Pool) {}

  async query<Row>(
    queryText: string,
    queryValues: readonly unknown[] = [],
  ): Promise<SqlQueryResult<Row>> {
    const queryResult = await this.databasePool.query(queryText, [...queryValues]);
    return {
      rows: queryResult.rows as Row[],
      rowCount: queryResult.rowCount,
    };
  }

  async connect(): Promise<SqlTransaction> {
    return new NodePostgresSqlTransaction(await this.databasePool.connect());
  }
}

function defaultAuditWriter(auditLine: string): void {
  process.stdout.write(`${auditLine}\n`);
}

/** Writes the stable credential-free callback audit contract as one JSON line. */
export class JsonLineOAuthCallbackAuditSink implements OAuthCallbackAuditSink {
  constructor(
    private readonly auditWriter: OAuthCallbackAuditWriter = defaultAuditWriter,
    private readonly currentTime: () => Date = () => new Date(),
  ) {}

  async record(auditEvent: OAuthCallbackAuditEvent): Promise<void> {
    const occurredAt = this.currentTime();
    if (!Number.isFinite(occurredAt.getTime())) {
      throw new Error('OAuth callback audit clock is invalid');
    }
    const auditLine = JSON.stringify({
      eventType: 'identity.oauth_callback',
      occurredAt: occurredAt.toISOString(),
      provider: auditEvent.provider,
      outcome: auditEvent.outcome,
      correlationId: auditEvent.correlationId,
      ...(auditEvent.userId ? { userId: auditEvent.userId } : {}),
      ...(auditEvent.workspaceId ? { workspaceId: auditEvent.workspaceId } : {}),
    });
    await this.auditWriter(auditLine);
  }
}

function requireConfiguration(
  environment: RuntimeEnvironment,
  configurationName: string,
): string {
  const configurationValue = environment[configurationName]?.trim();
  if (
    !configurationValue ||
    configurationValue.length > MAXIMUM_CONFIGURATION_LENGTH
  ) {
    throw new Error(
      `Required identity configuration is missing: ${configurationName}`,
    );
  }
  return configurationValue;
}

function requireDatabaseUrl(databaseUrlValue: string): string {
  const parsedDatabaseUrl = new URL(databaseUrlValue);
  if (
    parsedDatabaseUrl.protocol !== 'postgres:' &&
    parsedDatabaseUrl.protocol !== 'postgresql:'
  ) {
    throw new Error('Identity database URL must use PostgreSQL');
  }
  return databaseUrlValue;
}

function requireBoundedInteger(
  inputValue: string | undefined,
  defaultValue: number,
  minimumValue: number,
  maximumValue: number,
  errorMessage: string,
): number {
  if (inputValue === undefined || inputValue.trim() === '') {
    return defaultValue;
  }
  const parsedValue = Number(inputValue);
  if (
    !Number.isSafeInteger(parsedValue) ||
    parsedValue < minimumValue ||
    parsedValue > maximumValue
  ) {
    throw new Error(errorMessage);
  }
  return parsedValue;
}

function decodeSecretKey(encodedKey: unknown): Buffer {
  if (
    typeof encodedKey !== 'string' ||
    !ENCODED_KEY_PATTERN.test(encodedKey) ||
    encodedKey.length > 128
  ) {
    throw new Error('OAuth encryption keys are invalid');
  }
  const decodedKey = Buffer.from(encodedKey, 'base64');
  if (decodedKey.length !== 32) {
    throw new Error('OAuth encryption keys must decode to 32 bytes');
  }
  return decodedKey;
}

function parseSecretKeys(encodedKeysValue: string): Readonly<Record<string, Buffer>> {
  let parsedKeyMap: unknown;
  try {
    parsedKeyMap = JSON.parse(encodedKeysValue);
  } catch {
    throw new Error('OAuth encryption key configuration is invalid');
  }
  if (
    !parsedKeyMap ||
    typeof parsedKeyMap !== 'object' ||
    Array.isArray(parsedKeyMap)
  ) {
    throw new Error('OAuth encryption key configuration is invalid');
  }
  const keyEntries = Object.entries(parsedKeyMap);
  if (keyEntries.length === 0 || keyEntries.length > MAXIMUM_KEY_VERSIONS) {
    throw new Error('OAuth encryption key configuration is invalid');
  }
  return Object.freeze(
    Object.fromEntries(
      keyEntries.map(([keyVersion, encodedKey]) => {
        if (!KEY_VERSION_PATTERN.test(keyVersion)) {
          throw new Error('OAuth encryption key version is invalid');
        }
        return [keyVersion, decodeSecretKey(encodedKey)];
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

/** Production identity runtime and its bounded application surfaces. */
export class IdentityRuntime implements OnApplicationShutdown {
  private isClosed = false;

  constructor(
    private readonly databasePool: Pool,
    readonly application: OAuthHttpApplication,
    readonly callbackApplication: OAuthCallbackApplication,
    readonly dataRightsStatusApplication: AuthenticatedDataRightsStatusApplication,
  ) {}

  /** Closes the shared identity PostgreSQL pool exactly once. */
  async close(): Promise<void> {
    if (this.isClosed) {
      return;
    }
    this.isClosed = true;
    await this.databasePool.end();
  }

  /** Releases runtime resources during Nest application shutdown. */
  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }
}

/** Creates the production identity runtime from bounded environment configuration. */
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
  const encryptionKeys = parseSecretKeys(
    requireConfiguration(environment, 'IDENTITY_OAUTH_KEYS'),
  );
  const secretBox = new AesGcmSecretBox({
    currentKeyVersion,
    keys: encryptionKeys,
  });
  const googleClientId = requireConfiguration(
    environment,
    'IDENTITY_GOOGLE_CLIENT_ID',
  );
  const googleClientSecret = requireConfiguration(
    environment,
    'IDENTITY_GOOGLE_CLIENT_SECRET',
  );
  const googleRedirectUri = requireConfiguration(
    environment,
    'IDENTITY_GOOGLE_REDIRECT_URI',
  );
  const githubClientId = requireConfiguration(
    environment,
    'IDENTITY_GITHUB_CLIENT_ID',
  );
  const githubClientSecret = requireConfiguration(
    environment,
    'IDENTITY_GITHUB_CLIENT_SECRET',
  );
  const githubRedirectUri = requireConfiguration(
    environment,
    'IDENTITY_GITHUB_REDIRECT_URI',
  );
  const webOrigin = requireConfiguration(environment, 'LIFE_OS_WEB_ORIGIN');
  const providerRequestTimeoutMs = requireBoundedInteger(
    environment.IDENTITY_PROVIDER_REQUEST_TIMEOUT_MS,
    5_000,
    100,
    10_000,
    'Identity provider request timeout is invalid',
  );

  const databasePool = new Pool(createPoolConfiguration(environment));
  const sqlClient = new NodePostgresSqlClient(databasePool);
  const transactionService = new OAuthTransactionService(
    new PostgresOAuthTransactionRepository(sqlClient, secretBox),
  );
  const sessionService = new SessionService(
    new PostgresSessionRepository(sqlClient),
  );
  const identityService = new IdentityService(
    new PostgresIdentityRepository(sqlClient),
  );
  const oauthHttpApplication = new OAuthHttpApplication(
    transactionService,
    sessionService,
    {
      providers: {
        google: {
          clientId: googleClientId,
          redirectUri: googleRedirectUri,
        },
        github: {
          clientId: githubClientId,
          redirectUri: githubRedirectUri,
        },
      },
      webOrigin,
    },
  );
  const dataRightsStatusApplication =
    new AuthenticatedDataRightsStatusApplication(
      oauthHttpApplication,
      new PostgresDataRightsRequestLedger(sqlClient),
    );
  const providerHttpClient = new BoundedOAuthProviderHttpClient({
    timeoutMs: providerRequestTimeoutMs,
  });
  const callbackApplication = new OAuthCallbackApplication(
    transactionService,
    identityService,
    sessionService,
    {
      google: new GoogleOidcClient({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
        redirectUri: googleRedirectUri,
        requestTimeoutMs: providerRequestTimeoutMs,
      }),
      github: new GitHubOAuthClient({
        clientId: githubClientId,
        clientSecret: githubClientSecret,
        redirectUri: githubRedirectUri,
        httpClient: providerHttpClient,
      }),
    },
    new JsonLineOAuthCallbackAuditSink(),
    { webOrigin },
  );
  return new IdentityRuntime(
    databasePool,
    oauthHttpApplication,
    callbackApplication,
    dataRightsStatusApplication,
  );
}
