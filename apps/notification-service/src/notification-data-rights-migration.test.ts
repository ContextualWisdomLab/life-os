import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../migrations/0002_data_rights_erasure.sql',
);

async function migrationSql(): Promise<string> {
  return await readFile(migrationPath, 'utf8');
}

describe('Notification data-rights erasure database contract', () => {
  it('persists bounded UUIDv4 replay receipts with SHA-256 evidence', async () => {
    const sql = await migrationSql();

    expect(sql).toContain(
      'CREATE TABLE notification_service.data_rights_erasure_receipts',
    );
    for (const identifier of [
      'workspace_id',
      'idempotency_key',
      'request_id',
      'requested_by_user_id',
    ]) {
      expect(sql).toContain(`uuid_send(${identifier})`);
    }
    expect(sql).toContain('erased_records >= 0');
    expect(sql).toContain("receipt_sha256 ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain('PRIMARY KEY (workspace_id, idempotency_key)');
  });

  it('makes erasure atomic, replay-safe, and owner-authorized', async () => {
    const sql = await migrationSql();

    expect(sql).toContain(
      'CREATE FUNCTION notification_service.erase_workspace_data(',
    );
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = pg_catalog, notification_service');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain(
      "'notification.service:erase:' || target_workspace_id::text",
    );
    expect(sql).toContain('IF FOUND THEN');
    expect(sql).toContain('Notification erasure replay authority conflicts');
    expect(sql).toContain('sha256(');
    expect(sql).toContain("'notification.service'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION notification_service\.erase_workspace_data\([\s\S]*?\) FROM PUBLIC;/u,
    );
  });

  it('keeps append-only outcome protection active during owner-authorized erasure', async () => {
    const sql = await migrationSql();
    const inboxDelete = sql.indexOf(
      'DELETE FROM notification_service.inbox_messages',
    );
    const authorizationInsert = sql.indexOf(
      'INSERT INTO notification_service.data_rights_erasure_authorizations',
    );
    const outcomeDelete = sql.indexOf(
      'DELETE FROM notification_service.reminder_outcomes',
    );
    const authorizationDelete = sql.indexOf(
      'DELETE FROM notification_service.data_rights_erasure_authorizations',
    );
    const occurrenceDelete = sql.indexOf(
      'DELETE FROM notification_service.reminder_occurrences',
    );

    expect(sql).toContain(
      'CREATE TABLE notification_service.data_rights_erasure_authorizations',
    );
    expect(sql).toContain('pg_backend_pid()');
    expect(sql).toContain('pg_current_xact_id()');
    expect(sql).not.toContain('DISABLE TRIGGER');
    expect(sql).not.toContain('ENABLE TRIGGER reminder_outcomes_row_mutation_guard');
    expect(inboxDelete).toBeGreaterThan(-1);
    expect(authorizationInsert).toBeGreaterThan(inboxDelete);
    expect(outcomeDelete).toBeGreaterThan(authorizationInsert);
    expect(authorizationDelete).toBeGreaterThan(outcomeDelete);
    expect(occurrenceDelete).toBeGreaterThan(authorizationDelete);
  });
});
