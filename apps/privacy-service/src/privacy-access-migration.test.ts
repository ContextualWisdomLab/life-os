import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../migrations/0001_purpose_bound_privacy_access.sql',
);
const migration = readFileSync(migrationPath, 'utf8');

type ObjectKeyword =
  | 'CREATE TABLE'
  | 'CREATE INDEX'
  | 'CREATE OR REPLACE FUNCTION'
  | 'CREATE TRIGGER';

const OBJECT_PATTERNS: Readonly<Record<ObjectKeyword, RegExp>> = {
  'CREATE TABLE':
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_.]*)/giu,
  'CREATE INDEX':
    /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_.]*)/giu,
  'CREATE OR REPLACE FUNCTION':
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_.]*)/giu,
  'CREATE TRIGGER':
    /CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_.]*)/giu,
};

/** Extracts normalized database object names for one fixed migration keyword. */
function objectNames(keyword: ObjectKeyword): string[] {
  return [...migration.matchAll(OBJECT_PATTERNS[keyword])].map(
    (match) => match[1] ?? '',
  );
}

/** Requires every unqualified identifier segment to contain two snake-case words. */
function expectMultiwordSnakeCase(names: readonly string[]): void {
  for (const name of names) {
    for (const segment of name.split('.')) {
      expect(segment).toMatch(/^[a-z][a-z0-9]*_[a-z0-9_]+$/u);
    }
  }
}

describe('purpose-bound privacy access migration', () => {
  it('owns one dedicated multiword schema and three multiword tables', () => {
    expect(migration).toContain('CREATE SCHEMA IF NOT EXISTS privacy_access');
    expect(objectNames('CREATE TABLE')).toEqual([
      'privacy_access.privacy_access_decisions',
      'privacy_access.privacy_access_grants',
      'privacy_access.privacy_access_events',
    ]);
    expectMultiwordSnakeCase(objectNames('CREATE TABLE'));
  });

  it('uses only multiword snake-case constraints, indexes, functions, and triggers', () => {
    const constraints = [
      ...migration.matchAll(/CONSTRAINT\s+([a-z0-9_]+)/giu),
    ].map((match) => match[1] ?? '');
    const indexes = objectNames('CREATE INDEX');
    const functions = objectNames('CREATE OR REPLACE FUNCTION');
    const triggers = objectNames('CREATE TRIGGER');
    expect(constraints.length).toBeGreaterThan(10);
    expect(indexes).toHaveLength(4);
    expect(functions).toHaveLength(2);
    expect(triggers).toHaveLength(3);
    expectMultiwordSnakeCase([
      ...constraints,
      ...indexes,
      ...functions,
      ...triggers,
    ]);
  });

  it('stores metadata and digests without raw reason, resource reference, token, or payload columns', () => {
    for (const digestColumn of [
      'policy_digest',
      'request_digest',
      'reason_digest',
      'token_digest',
      'resource_reference_digest',
    ]) {
      expect(migration).toContain(digestColumn);
    }
    for (const forbiddenColumn of [
      ' raw_reason ',
      ' reason_text ',
      ' resource_reference ',
      ' grant_token ',
      ' personal_data ',
      ' pii_value ',
      ' payload_json ',
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbiddenColumn);
    }
  });

  it('enforces UUIDv4, digest, policy, grant, and consumption shape checks', () => {
    expect(
      migration.match(/substring\([^)]*from 15 for 1\) = '4'/gu)?.length,
    ).toBeGreaterThanOrEqual(8);
    expect(migration).toContain("policy_digest ~ '^[0-9a-f]{64}$'");
    expect(migration).toContain("decision_outcome IN ('allowed', 'denied')");
    expect(migration).toContain('privacy_decision_grant_shape_check');
    expect(migration).toContain('privacy_grant_consumption_shape_check');
    expect(migration).toContain(
      "(access_mode = 'break_glass') = (purpose_code = 'break_glass')",
    );
  });

  it('makes decision and event evidence append-only and restricts grant mutation', () => {
    expect(migration).toContain(
      'privacy_access.reject_privacy_evidence_mutation()',
    );
    expect(migration).toContain(
      'privacy_access.restrict_privacy_grant_mutation()',
    );
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON privacy_access.privacy_access_decisions',
    );
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON privacy_access.privacy_access_events',
    );
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON privacy_access.privacy_access_grants',
    );
    expect(migration).toContain('OLD.consumed_at IS NOT NULL');
    expect(migration).toContain('NEW.consumed_event_id IS NULL');
  });

  it('is transactional and contains no destructive migration path', () => {
    expect(migration.trimStart().startsWith('BEGIN;')).toBe(true);
    expect(migration.trimEnd().endsWith('COMMIT;')).toBe(true);
    expect(migration).not.toMatch(/DROP\s+(?:TABLE|SCHEMA)\s/iu);
    expect(migration).not.toContain('CASCADE');
    expect(migration).not.toContain('TRUNCATE');
  });
});
