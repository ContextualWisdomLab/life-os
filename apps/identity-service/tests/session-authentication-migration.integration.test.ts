import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.IDENTITY_DATABASE_URL;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const AUTHENTICATION_MIGRATION = '0004_session_authentication_age.sql';

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('IDENTITY_DATABASE_URL is required for PostgreSQL integration tests');
  }
  return DATABASE_URL;
}

function databaseName(): string {
  return `life_os_auth_migration_${randomUUID().replaceAll('-', '')}`;
}

function databaseUrl(sourceUrl: string, name: string): string {
  const parsed = new URL(sourceUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function quotedIdentifier(value: string): string {
  if (!/^life_os_auth_migration_[0-9a-f]{32}$/u.test(value)) {
    throw new Error('Temporary database name is invalid');
  }
  return `"${value}"`;
}

async function migrationFilesBeforeAuthenticationAge(): Promise<string[]> {
  const migrationDirectory = resolve(process.cwd(), 'migrations');
  return (await readdir(migrationDirectory))
    .filter(
      (file) =>
        file.endsWith('.sql') && file.localeCompare(AUTHENTICATION_MIGRATION) < 0,
    )
    .sort();
}

describeWithDatabase('session authentication-age migration', () => {
  it('backfills every legacy rotated session from its authenticated chain root', async () => {
    const sourceUrl = requireDatabaseUrl();
    const temporaryDatabase = databaseName();
    const adminPool = new Pool({ connectionString: databaseUrl(sourceUrl, 'postgres') });
    let migrationPool: Pool | undefined;

    try {
      await adminPool.query(`CREATE DATABASE ${quotedIdentifier(temporaryDatabase)}`);
      migrationPool = new Pool({
        connectionString: databaseUrl(sourceUrl, temporaryDatabase),
      });
      const migrationDirectory = resolve(process.cwd(), 'migrations');
      for (const migrationFile of await migrationFilesBeforeAuthenticationAge()) {
        const sql = await readFile(
          resolve(migrationDirectory, migrationFile),
          'utf8',
        );
        await migrationPool.query(sql);
      }

      const userId = randomUUID();
      const workspaceId = randomUUID();
      const rootSessionId = randomUUID();
      const childSessionId = randomUUID();
      const grandchildSessionId = randomUUID();
      const rootAuthenticatedAt = '2026-08-03T01:00:00.000Z';
      const childCreatedAt = '2026-08-03T01:15:00.000Z';
      const grandchildCreatedAt = '2026-08-03T01:30:00.000Z';

      await migrationPool.query(
        `INSERT INTO identity.users (id, display_name)
         VALUES ($1, $2)`,
        [userId, 'Legacy migration user'],
      );
      await migrationPool.query(
        `INSERT INTO identity.workspaces (id, owner_user_id, name, kind)
         VALUES ($1, $2, $3, 'personal')`,
        [workspaceId, userId, 'Legacy migration workspace'],
      );
      await migrationPool.query(
        `INSERT INTO identity.sessions (
           id, user_id, workspace_id, token_hash, created_at, expires_at,
           revoked_at, rotated_from_id
         ) VALUES
           ($1, $2, $3, $4, $5, $6, $7, NULL),
           ($8, $2, $3, $9, $10, $11, $12, $1),
           ($13, $2, $3, $14, $15, $16, NULL, $8)`,
        [
          rootSessionId,
          userId,
          workspaceId,
          '1'.repeat(64),
          rootAuthenticatedAt,
          '2026-08-03T02:00:00.000Z',
          childCreatedAt,
          childSessionId,
          '2'.repeat(64),
          childCreatedAt,
          '2026-08-03T02:15:00.000Z',
          grandchildCreatedAt,
          grandchildSessionId,
          '3'.repeat(64),
          grandchildCreatedAt,
          '2026-08-03T02:30:00.000Z',
        ],
      );

      const authenticationMigration = await readFile(
        resolve(migrationDirectory, AUTHENTICATION_MIGRATION),
        'utf8',
      );
      await migrationPool.query(authenticationMigration);

      const migrated = await migrationPool.query<{
        id: string;
        authenticated_at: Date;
        created_at: Date;
      }>(
        `SELECT id, authenticated_at, created_at
         FROM identity.sessions
         ORDER BY created_at ASC`,
      );

      expect(migrated.rows).toHaveLength(3);
      expect(
        migrated.rows.map((row) => row.authenticated_at.toISOString()),
      ).toEqual([
        rootAuthenticatedAt,
        rootAuthenticatedAt,
        rootAuthenticatedAt,
      ]);
      expect(migrated.rows[1]?.created_at.toISOString()).toBe(childCreatedAt);
      expect(migrated.rows[2]?.created_at.toISOString()).toBe(
        grandchildCreatedAt,
      );
    } finally {
      await migrationPool?.end();
      await adminPool.query(
        `DROP DATABASE IF EXISTS ${quotedIdentifier(temporaryDatabase)} WITH (FORCE)`,
      );
      await adminPool.end();
    }
  }, 30_000);
});
