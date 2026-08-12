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
    expect(sql).toContain('hashtextextended');
    expect(sql).toContain('IF FOUND THEN');
    expect(sql).toContain('Notification erasure replay authority conflicts');
    expect(sql).toContain('sha256(');
    expect(sql).toContain("'notification.service'");
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION notification_service\.erase_workspace_data\([\s\S]*?\) FROM PUBLIC;/u,
    );
  });

  it('deletes Notification-owned records in foreign-key-safe order and restores immutability', async () => {
    const sql = await migrationSql();
    const inboxDelete = sql.indexOf(
      'DELETE FROM notification_service.inbox_messages',
    );
    const outcomeDisable = sql.indexOf(
      'DISABLE TRIGGER reminder_outcomes_row_mutation_guard',
    );
    const outcomeDelete = sql.indexOf(
      'DELETE FROM notification_service.reminder_outcomes',
    );
    const outcomeEnable = sql.indexOf(
      'ENABLE TRIGGER reminder_outcomes_row_mutation_guard',
    );
    const occurrenceDelete = sql.indexOf(
      'DELETE FROM notification_service.reminder_occurrences',
    );

    expect(inboxDelete).toBeGreaterThan(-1);
    expect(outcomeDisable).toBeGreaterThan(inboxDelete);
    expect(outcomeDelete).toBeGreaterThan(outcomeDisable);
    expect(outcomeEnable).toBeGreaterThan(outcomeDelete);
    expect(occurrenceDelete).toBeGreaterThan(outcomeEnable);
  });
});
