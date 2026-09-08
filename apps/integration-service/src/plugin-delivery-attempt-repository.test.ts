import { describe, expect, it, vi } from 'vitest';
import type { PluginDeliveryAttemptRecord } from './plugin-delivery-attempt';
import {
  PluginDeliveryAttemptPersistenceEvidenceError,
  PluginDeliveryAttemptPersistenceValidationError,
  PostgresPluginDeliveryAttemptStore,
  type PluginDeliveryAttemptSqlClient,
} from './plugin-delivery-attempt-repository';

const RECORD: PluginDeliveryAttemptRecord = Object.freeze({
  authorityVersion: 'life-os.plugin-delivery-attempt.v1',
  deliveryId: '55555555-5555-4555-8555-555555555555',
  grantId: '11111111-1111-4111-8111-111111111111',
  installationId: '22222222-2222-4222-8222-222222222222',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  requestedByUserId: '44444444-4444-4444-8444-444444444444',
  status: 'pending',
  attemptCount: 0,
  maxAttempts: 4,
  requestedAt: '2026-09-08T04:40:00.000Z',
  updatedAt: '2026-09-08T04:40:00.000Z',
  nextAttemptAt: '2026-09-08T04:40:00.000Z',
  terminalAt: null,
  lastOutcomeCode: null,
});

function row(record: PluginDeliveryAttemptRecord = RECORD) {
  return {
    authority_version: record.authorityVersion,
    delivery_id: record.deliveryId,
    grant_id: record.grantId,
    installation_id: record.installationId,
    workspace_id: record.workspaceId,
    requested_by_user_id: record.requestedByUserId,
    delivery_status: record.status,
    attempt_count: record.attemptCount,
    max_attempts: record.maxAttempts,
    requested_at: new Date(record.requestedAt),
    updated_at: new Date(record.updatedAt),
    next_attempt_at: new Date(record.nextAttemptAt),
    terminal_at: record.terminalAt,
    last_outcome_code: record.lastOutcomeCode,
  };
}

describe('PostgresPluginDeliveryAttemptStore', () => {
  it('uses one parameterized idempotent admission statement and returns exact durable scope', async () => {
    const query = vi.fn(async () => ({ rows: [row()], rowCount: 1 }));
    const store = new PostgresPluginDeliveryAttemptStore({ query });

    await expect(store.createIfAbsent(RECORD)).resolves.toEqual(RECORD);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0] ?? [];
    expect(sql).toContain('plugin_integration.plugin_delivery_attempt_record');
    expect(sql).toContain('ON CONFLICT (delivery_id) DO NOTHING');
    expect(sql).not.toContain(RECORD.deliveryId);
    expect(values).toEqual([
      RECORD.authorityVersion,
      RECORD.deliveryId,
      RECORD.grantId,
      RECORD.installationId,
      RECORD.workspaceId,
      RECORD.requestedByUserId,
      RECORD.maxAttempts,
      RECORD.requestedAt,
    ]);
  });

  it('rejects malformed application records before issuing SQL', async () => {
    const query = vi.fn();
    const store = new PostgresPluginDeliveryAttemptStore({ query });

    await expect(
      store.createIfAbsent({ ...RECORD, maxAttempts: 0 } as PluginDeliveryAttemptRecord),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceValidationError);
    expect(query).not.toHaveBeenCalled();
  });

  it('fails closed when the durable idempotency winner is absent, ambiguous, or corrupt', async () => {
    const resultCases = [
      { rows: [], rowCount: 0 },
      { rows: [row(), row()], rowCount: 2 },
      { rows: [{ ...row(), grant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }], rowCount: 1 },
    ];

    for (const result of resultCases) {
      const client: PluginDeliveryAttemptSqlClient = {
        query: vi.fn(async () => result),
      };
      const store = new PostgresPluginDeliveryAttemptStore(client);
      await expect(store.createIfAbsent(RECORD)).rejects.toBeInstanceOf(
        PluginDeliveryAttemptPersistenceEvidenceError,
      );
    }
  });
});
