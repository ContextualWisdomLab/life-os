import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(__dirname, '../migrations/0002_data_rights_erasure.sql');

async function migrationSql(): Promise<string> {
  return await readFile(migrationPath, 'utf8');
}

describe('AI data-rights erasure database contract', () => {
  it('persists UUIDv4 replay receipts with SHA-256 evidence', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('CREATE TABLE ai.data_rights_erasure_receipts');
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
  });

  it('uses atomic owner-controlled replay serialization and core SHA-256 evidence', async () => {
    const sql = await migrationSql();
    expect(sql).toContain('CREATE FUNCTION ai.erase_workspace_data(');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain('SET search_path = pg_catalog, ai');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('IF FOUND THEN');
    expect(sql).toContain('AI erasure replay authority conflicts');
    expect(sql).toContain('sha256(');
    expect(sql).toContain("'ai.service'");
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION ai.erase_workspace_data(uuid, uuid, uuid, uuid) FROM PUBLIC;',
    );
  });

  it('deletes decisions before proposals and restores append-only triggers', async () => {
    const sql = await migrationSql();
    const decisionDisable = sql.indexOf(
      'DISABLE TRIGGER proposal_decision_events_append_only',
    );
    const decisionDelete = sql.indexOf('DELETE FROM ai.proposal_decision_events');
    const decisionEnable = sql.indexOf(
      'ENABLE TRIGGER proposal_decision_events_append_only',
    );
    const proposalDisable = sql.indexOf(
      'DISABLE TRIGGER proposal_audit_records_append_only',
    );
    const proposalDelete = sql.indexOf('DELETE FROM ai.proposal_audit_records');
    const proposalEnable = sql.indexOf(
      'ENABLE TRIGGER proposal_audit_records_append_only',
    );

    expect(decisionDisable).toBeGreaterThan(-1);
    expect(decisionDelete).toBeGreaterThan(decisionDisable);
    expect(decisionEnable).toBeGreaterThan(decisionDelete);
    expect(proposalDisable).toBeGreaterThan(decisionEnable);
    expect(proposalDelete).toBeGreaterThan(proposalDisable);
    expect(proposalEnable).toBeGreaterThan(proposalDelete);
  });
});
