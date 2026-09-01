import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.IDENTITY_DATABASE_URL;
const SEMANTIC_NAMING_MIGRATION = '0007_identity_database_semantic_names.sql';
const TEMPORARY_DATABASE_PREFIX = 'life_os_identity_semantic_names_';
const TEMPORARY_DATABASE_PATTERN =
  /^life_os_identity_semantic_names_[0-9a-f]{32}$/u;
const TEST_DATABASE_PATTERN = /^[a-z0-9_]*_test$/u;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;

async function readMigration(fileName: string): Promise<string> {
  return readFile(resolve(process.cwd(), 'migrations', fileName), 'utf8');
}

async function migrationFilesBeforeSemanticNaming(): Promise<string[]> {
  return (await readdir(resolve(process.cwd(), 'migrations')))
    .filter(
      (migrationFile) =>
        migrationFile.endsWith('.sql') &&
        migrationFile.localeCompare(SEMANTIC_NAMING_MIGRATION) < 0,
    )
    .sort();
}

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error(
      'IDENTITY_DATABASE_URL is required for PostgreSQL integration tests',
    );
  }
  const parsedUrl = new URL(DATABASE_URL);
  const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
  if (
    !LOOPBACK_HOSTS.has(parsedUrl.hostname) ||
    !TEST_DATABASE_PATTERN.test(databaseName)
  ) {
    throw new Error(
      'Identity semantic naming integration test requires a loopback test database',
    );
  }
  return DATABASE_URL;
}

function databaseUrl(sourceUrl: string, databaseName: string): string {
  const parsedUrl = new URL(sourceUrl);
  parsedUrl.pathname = `/${databaseName}`;
  return parsedUrl.toString();
}

function createTemporaryDatabaseName(): string {
  return `${TEMPORARY_DATABASE_PREFIX}${randomUUID().replaceAll('-', '')}`;
}

function requireTemporaryDatabaseIdentifier(databaseName: string): string {
  if (!TEMPORARY_DATABASE_PATTERN.test(databaseName)) {
    throw new Error('Temporary identity database name is invalid');
  }
  // PostgreSQL does not parameterize identifiers; the strict generated allowlist
  // makes this quoted identifier independent of repository or environment input.
  return `"${databaseName}"`;
}

async function withLegacyIdentityDatabase(
  execute: (databasePool: Pool) => Promise<void>,
): Promise<void> {
  const sourceUrl = requireDatabaseUrl();
  const temporaryDatabaseName = createTemporaryDatabaseName();
  const temporaryDatabaseIdentifier = requireTemporaryDatabaseIdentifier(
    temporaryDatabaseName,
  );
  const adminPool = new Pool({
    connectionString: databaseUrl(sourceUrl, 'postgres'),
  });
  let databasePool: Pool | undefined;
  let databaseCreated = false;

  try {
    await adminPool.query(`CREATE DATABASE ${temporaryDatabaseIdentifier}`);
    databaseCreated = true;
    databasePool = new Pool({
      connectionString: databaseUrl(sourceUrl, temporaryDatabaseName),
    });

    for (const migrationFile of await migrationFilesBeforeSemanticNaming()) {
      await databasePool.query(await readMigration(migrationFile));
    }
    await execute(databasePool);
  } finally {
    try {
      await databasePool?.end();
    } finally {
      try {
        if (databaseCreated) {
          await adminPool.query(`DROP DATABASE ${temporaryDatabaseIdentifier}`);
        }
      } finally {
        await adminPool.end();
      }
    }
  }
}

describe('identity database semantic naming contract', () => {
  it('ships a forward migration for the bounded-context database vocabulary', async () => {
    const migrationFiles = await readdir(resolve(process.cwd(), 'migrations'));
    expect(migrationFiles).toContain(SEMANTIC_NAMING_MIGRATION);
  });
});

describeWithDatabase('identity database semantic naming migration', () => {
  it('preserves persisted identity relationships while removing generic owned names', async () => {
    await withLegacyIdentityDatabase(async (databasePool) => {
      const userAccountId = randomUUID();
      const externalIdentityId = randomUUID();
      const identityWorkspaceId = randomUUID();
      const authenticationSessionId = randomUUID();
      const oauthTransactionId = randomUUID();
      const now = new Date('2026-09-02T00:00:00.000Z');
      const expiresAt = new Date('2026-09-03T00:00:00.000Z');

      // These statements intentionally exercise the pre-0007 compatibility schema.
      await databasePool.query(
        `INSERT INTO identity.users (id, display_name, created_at) VALUES ($1, $2, $3)`,
        [userAccountId, 'Semantic naming fixture', now],
      );
      await databasePool.query(
        `INSERT INTO identity.external_identities (id, user_id, provider, provider_subject, created_at)
         VALUES ($1, $2, 'github', $3, $4)`,
        [externalIdentityId, userAccountId, 'semantic-naming-fixture', now],
      );
      await databasePool.query(
        `INSERT INTO identity.workspaces (id, owner_user_id, name, kind, created_at)
         VALUES ($1, $2, $3, 'personal', $4)`,
        [identityWorkspaceId, userAccountId, 'Semantic workspace', now],
      );
      await databasePool.query(
        `INSERT INTO identity.sessions (
           id, user_id, workspace_id, token_hash, authenticated_at, created_at,
           expires_at, revoked_at, rotated_from_id
         ) VALUES ($1, $2, $3, $4, $5, $5, $6, NULL, NULL)`,
        [
          authenticationSessionId,
          userAccountId,
          identityWorkspaceId,
          'a'.repeat(64),
          now,
          expiresAt,
        ],
      );
      await databasePool.query(
        `INSERT INTO identity.oauth_transactions (
           id, state_hash, provider, browser_session_hash, code_verifier_ciphertext,
           code_verifier_key_version, nonce_ciphertext, nonce_key_version,
           redirect_uri, created_at, expires_at, consumed_at
         ) VALUES ($1, $2, 'github', $3, $4, $5, NULL, NULL, $6, $7, $8, NULL)`,
        [
          oauthTransactionId,
          'b'.repeat(64),
          'c'.repeat(64),
          Buffer.from('ciphertext'),
          'identity-key-v1',
          'https://app.example.test/oauth/callback',
          now,
          expiresAt,
        ],
      );

      await databasePool.query(await readMigration(SEMANTIC_NAMING_MIGRATION));

      const persistedIdentity = await databasePool.query<{
        user_account_id: string;
        external_identity_id: string;
        identity_provider: string;
        identity_workspace_id: string;
        workspace_name: string;
        authentication_session_id: string;
        oauth_transaction_id: string;
      }>(
        `SELECT
           user_accounts.user_account_id,
           external_identities.external_identity_id,
           external_identities.identity_provider,
           identity_workspaces.identity_workspace_id,
           identity_workspaces.workspace_name,
           authentication_sessions.authentication_session_id,
           oauth_transactions.oauth_transaction_id
         FROM identity.user_accounts
         JOIN identity.external_identities
           ON external_identities.user_account_id = user_accounts.user_account_id
         JOIN identity.identity_workspaces
           ON identity_workspaces.owner_user_account_id = user_accounts.user_account_id
         JOIN identity.authentication_sessions
           ON authentication_sessions.user_account_id = user_accounts.user_account_id
          AND authentication_sessions.identity_workspace_id = identity_workspaces.identity_workspace_id
         JOIN identity.oauth_transactions
           ON oauth_transactions.oauth_transaction_id = $1`,
        [oauthTransactionId],
      );

      expect(persistedIdentity.rows).toEqual([
        {
          user_account_id: userAccountId,
          external_identity_id: externalIdentityId,
          identity_provider: 'github',
          identity_workspace_id: identityWorkspaceId,
          workspace_name: 'Semantic workspace',
          authentication_session_id: authenticationSessionId,
          oauth_transaction_id: oauthTransactionId,
        },
      ]);

      const legacyTables = await databasePool.query<{ table_name: string }>(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'identity'
           AND table_name = ANY($1::text[])`,
        [['users', 'workspaces', 'sessions']],
      );
      expect(legacyTables.rows).toEqual([]);

      const genericColumns = await databasePool.query<{
        table_name: string;
        column_name: string;
      }>(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = 'identity'
           AND table_name = ANY($1::text[])
           AND column_name = ANY($2::text[])
         ORDER BY table_name, column_name`,
        [
          [
            'user_accounts',
            'external_identities',
            'identity_workspaces',
            'authentication_sessions',
            'oauth_transactions',
          ],
          [
            'id',
            'name',
            'provider',
            'kind',
            'user_id',
            'workspace_id',
            'owner_user_id',
            'rotated_from_id',
          ],
        ],
      );
      expect(genericColumns.rows).toEqual([]);
    });
  }, 30_000);
});
