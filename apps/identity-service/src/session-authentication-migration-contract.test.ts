import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const AUTHENTICATION_MIGRATION = '0004_session_authentication_age.sql';

/** Reads one identity migration from the package-owned migration directory. */
async function readMigration(fileName: string): Promise<string> {
  return readFile(resolve(process.cwd(), 'migrations', fileName), 'utf8');
}

describe('session authentication-age migration contract', () => {
  it('adds authentication constraints without validating the full table in the backfill migration', async () => {
    const migration = await readMigration(AUTHENTICATION_MIGRATION);

    expect(migration).toMatch(
      /ADD CONSTRAINT sessions_authentication_present[\s\S]*CHECK \(authenticated_at IS NOT NULL\)[\s\S]*NOT VALID/u,
    );
    expect(migration).toMatch(
      /ADD CONSTRAINT sessions_authentication_not_after_creation[\s\S]*CHECK \(authenticated_at <= created_at\)[\s\S]*NOT VALID/u,
    );
    expect(migration).not.toMatch(/ALTER COLUMN authenticated_at SET NOT NULL/u);
    expect(migration).not.toMatch(/VALIDATE CONSTRAINT/u);
  });
});
