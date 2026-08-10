import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.IDENTITY_DATABASE_URL;
const TEMPORARY_DATABASE_PREFIX = 'life_os_id_migration_';
const TEMPORARY_DATABASE_PATTERN = /^life_os_id_migration_[0-9a-f]{32}$/u;
const describeWithDatabase = DATABASE_URL ? describe : describe.skip;
const AUTHENTICATION_MIGRATION = '0004_session_authentication_age.sql';
const AUTHENTICATION_FINALIZATION_MIGRATION =
  '0005_finalize_session_authentication_age.sql';

function requireDatabaseUrl(): string {
  if (!DATABASE_URL) {
    throw new Error('IDENTITY_DATABASE_URL is required for PostgreSQL integration tests');
  }
  return DATABASE_URL;
}

function databaseUrl(sourceUrl: string, name: string): string {
  const parsed = new URL(sourceUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function temporaryDatabaseName(): string {
  const name = `${TEMPORARY_DATABASE_PREFIX}${randomUUID().replaceAll('-', '')}`;
  if (!TEMPORARY_DATABASE_PATTERN.test(name)) {
    throw new Error('Generated temporary database name is invalid');
  }
  return name;
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

async function readMigration(fileName: string): Promise<string> {
  return readFile(resolve(process.cwd(), 'migrations', fileName), 'utf8');
}

async function prepareLegacyDatabase(pool: Pool): Promise<void> {
  const migrationDirectory = resolve(process.cwd(), 'migrations');
  for (const migrationFile of await migrationFilesBeforeAuthenticationAge()) {
    const sql = await readFile(resolve(migrationDirectory, migrationFile), 'utf8');
    await pool.query(sql);
  }
}

async function applyAuthenticationAgeMigrations(pool: Pool): Promise<void> {
  await pool.query(await readMigration(AUTHENTICATION_MIGRATION));
  await pool.query(await readMigration(AUTHENTICATION_FINALIZATION_MIGRATION));
}

async function withTemporaryDatabase(
  execute: (pool: Pool) => Promise<void>,
): Promise<void> {
  const sourceUrl = requireDatabaseUrl();
  const databaseName = temporaryDatabaseName();
  const adminPool = new Pool({
    connectionString: databaseUrl(sourceUrl, 'postgres'),
  });
  let migrationPool: Pool | undefined;
  let databaseCreated = false;

  try {
    await adminPool.query(`CREATE DATABASE ${databaseName}`);
    databaseCreated = true;
    migrationPool = new Pool({
      connectionString: databaseUrl(sourceUrl, databaseName),
    });
    await prepareLegacyDatabase(migrationPool);
    await execute(migrationPool);
  } finally {
    try {
      await migrationPool?.end();
    } finally {
      try {
        if (databaseCreated) {
          await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
        }
      } finally {
        await adminPool.end();
      }
    }
  }
}

async function insertUserAndWorkspace(
  pool: Pool,
  userId: string,
  workspaceId: string,
  suffix: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO identity.users (id, display_name)
     VALUES ($1, $2)`,
    [userId, `Legacy migration user ${suffix}`],
  );
  await pool.query(
    `INSERT INTO identity.workspaces (id, owner_user_id, name, kind)
     VALUES ($1, $2, $3, 'personal')`,
    [workspaceId, userId, `Legacy migration workspace ${suffix}`],
  );
}

async function insertSession(
  pool: Pool,
  {
    id,
    userId,
    workspaceId,
    tokenSeed,
    createdAt,
    expiresAt,
    revokedAt = null,
    rotatedFromId = null,
  }: Readonly<{
    id: string;
    userId: string;
    workspaceId: string;
    tokenSeed: string;
    createdAt: string;
    expiresAt: string;
    revokedAt?: string | null;
    rotatedFromId?: string | null;
  }>,
): Promise<void> {
  await pool.query(
    `INSERT INTO identity.sessions (
       id, user_id, workspace_id, token_hash, created_at, expires_at,
       revoked_at, rotated_from_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      userId,
      workspaceId,
      tokenSeed.repeat(64),
      createdAt,
      expiresAt,
      revokedAt,
      rotatedFromId,
    ],
  );
}

describeWithDatabase('session authentication-age migration', () => {
  it('isolates concurrent migration fixtures in independently disposable databases', async () => {
    const completed: string[] = [];
    const databaseNames: string[] = [];

    await Promise.all([
      withTemporaryDatabase(async (migrationPool) => {
        const database = await migrationPool.query<{ database_name: string }>(
          'SELECT current_database() AS database_name',
        );
        databaseNames.push(database.rows[0]?.database_name ?? '');
        await migrationPool.query('SELECT pg_sleep(0.05)');
        completed.push('first');
      }),
      withTemporaryDatabase(async (migrationPool) => {
        const database = await migrationPool.query<{ database_name: string }>(
          'SELECT current_database() AS database_name',
        );
        databaseNames.push(database.rows[0]?.database_name ?? '');
        await migrationPool.query('SELECT 1');
        completed.push('second');
      }),
    ]);

    expect(completed).toHaveLength(2);
    expect(new Set(completed)).toEqual(new Set(['first', 'second']));
    expect(databaseNames).toHaveLength(2);
    expect(new Set(databaseNames)).toHaveLength(2);
    for (const databaseName of databaseNames) {
      expect(databaseName).toMatch(TEMPORARY_DATABASE_PATTERN);
    }
  }, 30_000);

  it('backfills every legacy rotated session from its authenticated chain root', async () => {
    await withTemporaryDatabase(async (migrationPool) => {
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const rootSessionId = randomUUID();
      const childSessionId = randomUUID();
      const grandchildSessionId = randomUUID();
      const rootAuthenticatedAt = '2026-08-03T01:00:00.000Z';
      const childCreatedAt = '2026-08-03T01:15:00.000Z';
      const grandchildCreatedAt = '2026-08-03T01:30:00.000Z';

      await insertUserAndWorkspace(
        migrationPool,
        userId,
        workspaceId,
        'valid',
      );
      await insertSession(migrationPool, {
        id: rootSessionId,
        userId,
        workspaceId,
        tokenSeed: '1',
        createdAt: rootAuthenticatedAt,
        expiresAt: '2026-08-03T02:00:00.000Z',
        revokedAt: childCreatedAt,
      });
      await insertSession(migrationPool, {
        id: childSessionId,
        userId,
        workspaceId,
        tokenSeed: '2',
        createdAt: childCreatedAt,
        expiresAt: '2026-08-03T02:15:00.000Z',
        revokedAt: grandchildCreatedAt,
        rotatedFromId: rootSessionId,
      });
      await insertSession(migrationPool, {
        id: grandchildSessionId,
        userId,
        workspaceId,
        tokenSeed: '3',
        createdAt: grandchildCreatedAt,
        expiresAt: '2026-08-03T02:30:00.000Z',
        rotatedFromId: childSessionId,
      });

      await applyAuthenticationAgeMigrations(migrationPool);

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
    });
  }, 30_000);

  it('rejects a rotation lineage that crosses valid user-workspace ownership pairs', async () => {
    await withTemporaryDatabase(async (migrationPool) => {
      const rootUserId = randomUUID();
      const childUserId = randomUUID();
      const rootWorkspaceId = randomUUID();
      const childWorkspaceId = randomUUID();
      const rootSessionId = randomUUID();

      await insertUserAndWorkspace(
        migrationPool,
        rootUserId,
        rootWorkspaceId,
        'root-owner',
      );
      await insertUserAndWorkspace(
        migrationPool,
        childUserId,
        childWorkspaceId,
        'child-owner',
      );
      await insertSession(migrationPool, {
        id: rootSessionId,
        userId: rootUserId,
        workspaceId: rootWorkspaceId,
        tokenSeed: '4',
        createdAt: '2026-08-03T01:00:00.000Z',
        expiresAt: '2026-08-03T02:00:00.000Z',
      });
      await insertSession(migrationPool, {
        id: randomUUID(),
        userId: childUserId,
        workspaceId: childWorkspaceId,
        tokenSeed: '5',
        createdAt: '2026-08-03T01:15:00.000Z',
        expiresAt: '2026-08-03T02:15:00.000Z',
        rotatedFromId: rootSessionId,
      });

      await migrationPool.query(await readMigration(AUTHENTICATION_MIGRATION));
      await expect(
        migrationPool.query(
          await readMigration(AUTHENTICATION_FINALIZATION_MIGRATION),
        ),
      ).rejects.toThrow(/sessions_authentication_present/u);
    });
  }, 30_000);

  it('keeps cross-workspace user mismatches impossible before authentication-age migration', async () => {
    await withTemporaryDatabase(async (migrationPool) => {
      const rootUserId = randomUUID();
      const otherUserId = randomUUID();
      const rootWorkspaceId = randomUUID();
      const otherWorkspaceId = randomUUID();

      await insertUserAndWorkspace(
        migrationPool,
        rootUserId,
        rootWorkspaceId,
        'root-workspace',
      );
      await insertUserAndWorkspace(
        migrationPool,
        otherUserId,
        otherWorkspaceId,
        'other-workspace',
      );

      await expect(
        insertSession(migrationPool, {
          id: randomUUID(),
          userId: rootUserId,
          workspaceId: otherWorkspaceId,
          tokenSeed: '6',
          createdAt: '2026-08-03T01:15:00.000Z',
          expiresAt: '2026-08-03T02:15:00.000Z',
        }),
      ).rejects.toThrow(/sessions_workspace_owner_fk/u);
    });
  }, 30_000);
});
