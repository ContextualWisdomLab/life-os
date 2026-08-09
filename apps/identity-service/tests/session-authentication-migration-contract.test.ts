import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const AUTHENTICATION_MIGRATION = '0004_session_authentication_age.sql';
const AUTHENTICATION_FINALIZATION_MIGRATION =
  '0005_finalize_session_authentication_age.sql';

/** Reads one identity migration from the package-owned migration directory. */
async function readMigration(fileName: string): Promise<string> {
  return readFile(resolve(process.cwd(), 'migrations', fileName), 'utf8');
}

describe('session authentication-age migration contract', () => {
  it('stages authentication constraints before the full validation migration', async () => {
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

  it('validates both constraints before the short final not-null transition', async () => {
    const migration = await readMigration(AUTHENTICATION_FINALIZATION_MIGRATION);
    const presenceValidation = migration.indexOf(
      'VALIDATE CONSTRAINT sessions_authentication_present',
    );
    const chronologyValidation = migration.indexOf(
      'VALIDATE CONSTRAINT sessions_authentication_not_after_creation',
    );
    const notNullTransition = migration.indexOf(
      'ALTER COLUMN authenticated_at SET NOT NULL',
    );

    expect(presenceValidation).toBeGreaterThanOrEqual(0);
    expect(chronologyValidation).toBeGreaterThanOrEqual(0);
    expect(notNullTransition).toBeGreaterThan(presenceValidation);
    expect(notNullTransition).toBeGreaterThan(chronologyValidation);
    expect(migration).toMatch(/DROP CONSTRAINT sessions_authentication_present/u);
  });
});
