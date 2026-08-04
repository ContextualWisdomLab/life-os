import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(
  __dirname,
  '../migrations/0001_durable_reminder_inbox.sql',
);

async function migrationSql(): Promise<string> {
  return await readFile(migrationPath, 'utf8');
}

describe('durable notification database contract', () => {
  it('uses only dedicated multi-word snake_case objects', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS notification_service');
    for (const tableName of [
      'notification_service.reminder_occurrences',
      'notification_service.reminder_outcomes',
      'notification_service.inbox_messages',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
    }

    const objectNames = [
      ...sql.matchAll(
        /(?:CONSTRAINT|INDEX(?: IF NOT EXISTS)?)\s+([a-z][a-z0-9_]*)/gu,
      ),
    ].map((match) => match[1]);
    expect(objectNames.length).toBeGreaterThan(12);
    expect(
      objectNames.every((name) => name !== undefined && name.includes('_')),
    ).toBe(true);

    const columnNames = [
      'reminder_id',
      'workspace_id',
      'reminder_title',
      'due_instant',
      'time_zone',
      'quiet_start_minute',
      'quiet_end_minute',
      'daily_delivery_limit',
      'delivery_attempt_count',
      'occurrence_status',
      'claim_key_hash',
      'claim_expires_at',
      'outcome_id',
      'outcome_kind',
      'occurred_at',
      'next_attempt_at',
      'outcome_reason',
      'idempotency_key_hash',
      'delivery_local_date',
      'message_id',
      'message_title',
      'delivered_at',
      'read_at',
      'created_at',
      'updated_at',
    ];
    for (const columnName of columnNames) {
      expect(sql).toMatch(new RegExp(`\\b${columnName}\\b`, 'u'));
      expect(columnName).toContain('_');
    }
  });

  it('enforces UUIDv4, policy, state, and digest invariants', async () => {
    const sql = await migrationSql();

    expect(sql).toContain("get_byte(uuid_send(reminder_id), 6) >> 4 = 4");
    expect(sql).toContain("get_byte(uuid_send(workspace_id), 6) >> 4 = 4");
    expect(sql).toContain("get_byte(uuid_send(outcome_id), 6) >> 4 = 4");
    expect(sql).toContain("get_byte(uuid_send(message_id), 6) >> 4 = 4");
    expect(sql).toContain('char_length(reminder_title) BETWEEN 1 AND 160');
    expect(sql).toContain('octet_length(reminder_title) <= 1024');
    expect(sql).toContain('quiet_start_minute BETWEEN 0 AND 1439');
    expect(sql).toContain('quiet_end_minute BETWEEN 0 AND 1439');
    expect(sql).toContain('daily_delivery_limit BETWEEN 1 AND 20');
    expect(sql).toContain('delivery_attempt_count BETWEEN 0 AND 3');
    expect(sql).toContain("occurrence_status IN ('pending', 'delivered', 'failed')");
    expect(sql).toContain("outcome_kind IN ('delivered', 'deferred', 'failed')");
    expect(sql).toContain("outcome_reason IN ('quiet_hours', 'daily_limit', 'delivery_failed', 'attempt_limit')");
    expect(sql.match(/octet_length\((?:claim_key_hash|idempotency_key_hash)\) = 32/gu)).toHaveLength(3);
    expect(sql).not.toMatch(/\b(?:serial|bigserial)\b/iu);
  });

  it('supports deterministic due work, tenant reads, and exact idempotency', async () => {
    const sql = await migrationSql();

    expect(sql).toContain('reminder_occurrences_due_index');
    expect(sql).toContain('reminder_outcomes_workspace_index');
    expect(sql).toContain('inbox_messages_workspace_index');
    expect(sql).toContain('reminder_outcomes_idempotency_unique');
    expect(sql).toContain('inbox_messages_idempotency_unique');
    expect(sql).toContain('FOREIGN KEY (workspace_id, reminder_id)');
    expect(sql).toContain('REFERENCES notification_service.reminder_occurrences (workspace_id, reminder_id)');
  });
});
