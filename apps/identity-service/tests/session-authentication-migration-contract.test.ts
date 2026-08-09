import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const AUTHENTICATION_MIGRATION = '0004_session_authentication_age.sql';
const AUTHENTICATION_FINALIZATION_MIGRATION =
  '0005_finalize_session_authentication_age.sql';
const STAGED_VALIDATION_CLAUSE = ['NOT', 'VALID'].join(' ');
const VALIDATE_CONSTRAINT_CLAUSE = ['VALIDATE', 'CONSTRAINT'].join(' ');
const SET_NOT_NULL_CLAUSE = ['SET', 'NOT', 'NULL'].join(' ');

/** Reads one identity migration from the package-owned migration directory. */
async function readMigration(fileName: string): Promise<string> {
  return readFile(resolve(process.cwd(), 'migrations', fileName), 'utf8');
}

/** Collapses SQL layout whitespace without changing the asserted SQL tokens. */
function normalizeSql(source: string): string {
  return source.replace(/\s+/gu, ' ').trim();
}

describe('session authentication-age migration contract', () => {
  it('stages authentication constraints before the full validation migration', async () => {
    const migration = normalizeSql(
      await readMigration(AUTHENTICATION_MIGRATION),
    );

    expect(migration).toContain(
      `ADD CONSTRAINT sessions_authentication_present CHECK (authenticated_at IS NOT NULL) ${STAGED_VALIDATION_CLAUSE}`,
    );
    expect(migration).toContain(
      `ADD CONSTRAINT sessions_authentication_not_after_creation CHECK (authenticated_at <= created_at) ${STAGED_VALIDATION_CLAUSE}`,
    );
    expect(
      migration.includes(`ALTER COLUMN authenticated_at ${SET_NOT_NULL_CLAUSE}`),
    ).toBe(false);
    expect(migration.includes(VALIDATE_CONSTRAINT_CLAUSE)).toBe(false);
  });

  it('validates both constraints before the short final not-null transition', async () => {
    const migration = normalizeSql(
      await readMigration(AUTHENTICATION_FINALIZATION_MIGRATION),
    );
    const presenceValidation = migration.indexOf(
      `${VALIDATE_CONSTRAINT_CLAUSE} sessions_authentication_present`,
    );
    const chronologyValidation = migration.indexOf(
      `${VALIDATE_CONSTRAINT_CLAUSE} sessions_authentication_not_after_creation`,
    );
    const notNullTransition = migration.indexOf(
      `ALTER COLUMN authenticated_at ${SET_NOT_NULL_CLAUSE}`,
    );

    expect(presenceValidation).toBeGreaterThanOrEqual(0);
    expect(chronologyValidation).toBeGreaterThanOrEqual(0);
    expect(notNullTransition).toBeGreaterThan(presenceValidation);
    expect(notNullTransition).toBeGreaterThan(chronologyValidation);
    expect(migration).toContain(
      'DROP CONSTRAINT sessions_authentication_present',
    );
  });
});
