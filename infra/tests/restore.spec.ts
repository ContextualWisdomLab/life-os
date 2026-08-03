import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const POSTGRES_CLIENT_IMAGE =
  'postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const ADMIN_DATABASE_NAME = 'postgres';
const SOURCE_DATABASE_NAME = 'life_os_backup_source';
const TARGET_DATABASE_NAME = 'life_os_restore_target';
const TEST_DATABASE_PASSWORD = ['post', 'gres'].join('');
const TEST_DATABASE_AUTHORITY = `postgres:${TEST_DATABASE_PASSWORD}@127.0.0.1:5432`;
const ADMIN_DATABASE_URL = `postgresql://${TEST_DATABASE_AUTHORITY}/${ADMIN_DATABASE_NAME}`;
const SOURCE_DATABASE_URL = `postgresql://${TEST_DATABASE_AUTHORITY}/${SOURCE_DATABASE_NAME}`;
const TARGET_DATABASE_URL = `postgresql://${TEST_DATABASE_AUTHORITY}/${TARGET_DATABASE_NAME}`;

const testRoot = mkdtempSync(join(tmpdir(), 'life-os-backup-recovery-'));
const toolDirectory = join(testRoot, 'bin');
const backupDirectory = join(testRoot, 'backups');
const backupScript = resolve(process.cwd(), '../backup/backup.sh');
const restoreScript = resolve(process.cwd(), '../backup/restore.sh');

function createPostgresClientWrapper(commandName: string): void {
  const wrapperPath = join(toolDirectory, commandName);
  writeFileSync(
    wrapperPath,
    `#!/usr/bin/env bash
set -Eeuo pipefail
exec docker run --rm --network host \\
  --user "$(id -u):$(id -g)" \\
  --env HOME=/tmp \\
  --env PGDATABASE \\
  --volume "\${BACKUP_RECOVERY_MOUNT_ROOT}:\${BACKUP_RECOVERY_MOUNT_ROOT}" \\
  "\${POSTGRES_CLIENT_IMAGE}" ${commandName} "$@"
`,
    { mode: 0o700 },
  );
  chmodSync(wrapperPath, 0o700);
}

const commandEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  BACKUP_RECOVERY_MOUNT_ROOT: testRoot,
  PATH: `${toolDirectory}${delimiter}${process.env.PATH ?? ''}`,
  POSTGRES_CLIENT_IMAGE,
};

function runPsql(databaseUrl: string, sql: string): string {
  return execFileSync(
    'psql',
    [
      '--dbname',
      databaseUrl,
      '--no-psqlrc',
      '--tuples-only',
      '--no-align',
      '--set=ON_ERROR_STOP=1',
      '--command',
      sql,
    ],
    { encoding: 'utf8', env: commandEnvironment },
  ).trim();
}

function resetDatabase(databaseName: string): void {
  dropDatabase(databaseName);
  runPsql(ADMIN_DATABASE_URL, `CREATE DATABASE ${databaseName};`);
}

function dropDatabase(databaseName: string): void {
  runPsql(
    ADMIN_DATABASE_URL,
    `DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE);`,
  );
}

function runRestore(archivePath: string): string {
  return execFileSync('bash', [restoreScript], {
    encoding: 'utf8',
    env: {
      ...commandEnvironment,
      BACKUP_ARCHIVE: archivePath,
      DATABASE_URL: TARGET_DATABASE_URL,
      LIFEOS_RESTORE_CONFIRMATION: 'restore-empty-database',
    },
  });
}

const linuxOnly = process.platform === 'linux';

describe.skipIf(!linuxOnly)('PostgreSQL backup and restore contract', () => {
  beforeAll(() => {
    mkdirSync(toolDirectory, { recursive: true });
    mkdirSync(backupDirectory, { recursive: true });
    createPostgresClientWrapper('pg_dump');
    createPostgresClientWrapper('pg_restore');
    createPostgresClientWrapper('psql');

    resetDatabase(SOURCE_DATABASE_NAME);
    resetDatabase(TARGET_DATABASE_NAME);
    runPsql(
      SOURCE_DATABASE_URL,
      `CREATE SCHEMA recovery_contract;
       CREATE TABLE recovery_contract.tenant_records (
         workspace_id uuid NOT NULL,
         record_name text NOT NULL,
         record_value text NOT NULL,
         PRIMARY KEY (workspace_id, record_name)
       );
       INSERT INTO recovery_contract.tenant_records
         (workspace_id, record_name, record_value)
       VALUES
         ('3b237d04-e84c-4ac4-933d-7f179865e1a0', 'daily_plan', 'Prepare launch'),
         ('474c83ae-08af-4a63-957b-49eb2093a61d', 'weekly_review', 'Close open loops');`,
    );
  }, 120_000);

  afterAll(() => {
    try {
      dropDatabase(SOURCE_DATABASE_NAME);
      dropDatabase(TARGET_DATABASE_NAME);
    } finally {
      rmSync(testRoot, { force: true, recursive: true });
    }
  }, 120_000);

  it(
    'creates an atomic verified archive and restores tenant data into an empty database',
    () => {
      const backupOutput = execFileSync('bash', [backupScript], {
        encoding: 'utf8',
        env: {
          ...commandEnvironment,
          BACKUP_DIRECTORY: backupDirectory,
          DATABASE_URL: SOURCE_DATABASE_URL,
        },
      });
      const archivePath = /^backup_archive=(.+)$/m.exec(backupOutput)?.[1];
      expect(archivePath).toBeDefined();
      const resolvedArchivePath = archivePath ?? '';
      expect(statSync(resolvedArchivePath).size).toBeGreaterThan(0);
      expect(statSync(resolvedArchivePath).mode & 0o777).toBe(0o600);
      expect(statSync(`${resolvedArchivePath}.sha256`).mode & 0o777).toBe(
        0o600,
      );
      expect(readFileSync(`${resolvedArchivePath}.metadata`, 'utf8')).toMatch(
        /^schema=life-os\.backup-metadata\.v1$/m,
      );
      expect(
        readdirSync(backupDirectory).filter((name) =>
          name.startsWith('.life-os-backup.'),
        ),
      ).toEqual([]);

      const restoreOutput = runRestore(resolvedArchivePath);
      expect(restoreOutput).toMatch(/^restore_status=completed$/m);
      expect(restoreOutput).toMatch(/^restore_duration_seconds=\d+$/m);
      expect(
        runPsql(
          TARGET_DATABASE_URL,
          'SELECT record_name || E\'\\t\' || record_value FROM recovery_contract.tenant_records ORDER BY record_name;',
        ).split('\n'),
      ).toEqual([
        'daily_plan\tPrepare launch',
        'weekly_review\tClose open loops',
      ]);

      expect(() => runRestore(resolvedArchivePath)).toThrow();
      expect(
        runPsql(
          TARGET_DATABASE_URL,
          'SELECT count(*) FROM recovery_contract.tenant_records;',
        ),
      ).toBe('2');

      resetDatabase(TARGET_DATABASE_NAME);
      writeFileSync(
        `${resolvedArchivePath}.sha256`,
        `${'0'.repeat(64)}  ${resolvedArchivePath.split('/').at(-1)}\n`,
        { mode: 0o600 },
      );
      expect(() => runRestore(resolvedArchivePath)).toThrow();
      expect(
        runPsql(
          TARGET_DATABASE_URL,
          `SELECT count(*) FROM pg_catalog.pg_class AS relation
           JOIN pg_catalog.pg_namespace AS namespace
             ON namespace.oid = relation.relnamespace
           WHERE namespace.nspname NOT IN ('pg_catalog', 'information_schema')
             AND namespace.nspname !~ '^pg_toast'
             AND relation.relkind IN ('r', 'p', 'v', 'm', 'S', 'f');`,
        ),
      ).toBe('0');
    },
    180_000,
  );
});
