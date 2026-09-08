import { describe, expect, it } from 'vitest';
import type { PluginDeliveryAttemptRecord } from './plugin-delivery-attempt';
import {
  PluginDeliveryAttemptPersistenceEvidenceError,
  PluginDeliveryAttemptPersistenceValidationError,
  PostgresPluginDeliveryAttemptStore,
  type PluginDeliveryAttemptSqlClient,
  type PluginDeliveryAttemptSqlResult,
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

interface QueryCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class ScriptedSqlClient implements PluginDeliveryAttemptSqlClient {
  readonly calls: QueryCall[] = [];

  constructor(
    private readonly results: PluginDeliveryAttemptSqlResult<Record<string, unknown>>[],
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PluginDeliveryAttemptSqlResult<Row>> {
    this.calls.push({ text, values });
    const next = this.results.shift();
    if (!next) {
      throw new Error('Unexpected SQL call');
    }
    return next as PluginDeliveryAttemptSqlResult<Row>;
  }
}

function row(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    authority_version: RECORD.authorityVersion,
    delivery_id: RECORD.deliveryId,
    grant_id: RECORD.grantId,
    installation_id: RECORD.installationId,
    workspace_id: RECORD.workspaceId,
    requested_by_user_id: RECORD.requestedByUserId,
    delivery_status: RECORD.status,
    attempt_count: RECORD.attemptCount,
    max_attempts: RECORD.maxAttempts,
    requested_at: new Date(RECORD.requestedAt),
    updated_at: new Date(RECORD.updatedAt),
    next_attempt_at: new Date(RECORD.nextAttemptAt),
    terminal_at: RECORD.terminalAt,
    last_outcome_code: RECORD.lastOutcomeCode,
    ...overrides,
  };
}

function result(
  rows: readonly Record<string, unknown>[],
): PluginDeliveryAttemptSqlResult<Record<string, unknown>> {
  return { rows, rowCount: rows.length };
}

describe('PostgresPluginDeliveryAttemptStore', () => {
  it('uses one parameterized idempotent admission statement and returns exact durable scope', async () => {
    const client = new ScriptedSqlClient([result([row()])]);
    const store = new PostgresPluginDeliveryAttemptStore(client);

    await expect(store.createIfAbsent(RECORD)).resolves.toEqual(RECORD);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'plugin_integration.plugin_delivery_attempt_record',
    );
    expect(client.calls[0]?.text).toContain(
      'ON CONFLICT (delivery_id) DO NOTHING',
    );
    expect(client.calls[0]?.text).not.toContain(RECORD.deliveryId);
    expect(client.calls[0]?.values).toEqual([
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

  it('re-reads the exact durable winner with a fresh statement after a conflict snapshot returns no row', async () => {
    const client = new ScriptedSqlClient([result([]), result([row()])]);
    const store = new PostgresPluginDeliveryAttemptStore(client);

    await expect(store.createIfAbsent(RECORD)).resolves.toEqual(RECORD);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0]?.text).toContain(
      'ON CONFLICT (delivery_id) DO NOTHING',
    );
    expect(client.calls[1]?.text).toContain('WHERE delivery_id = $1::uuid');
    expect(client.calls[1]?.text).toContain('grant_id = $2::uuid');
    expect(client.calls[1]?.text).toContain('installation_id = $3::uuid');
    expect(client.calls[1]?.text).toContain('workspace_id = $4::uuid');
    expect(client.calls[1]?.text).toContain('requested_by_user_id = $5::uuid');
    expect(client.calls[1]?.values).toEqual([
      RECORD.deliveryId,
      RECORD.grantId,
      RECORD.installationId,
      RECORD.workspaceId,
      RECORD.requestedByUserId,
      RECORD.maxAttempts,
    ]);
  });

  it('rejects malformed application records before issuing SQL', async () => {
    const client = new ScriptedSqlClient([]);
    const store = new PostgresPluginDeliveryAttemptStore(client);

    await expect(
      store.createIfAbsent({
        ...RECORD,
        maxAttempts: 0,
      } as PluginDeliveryAttemptRecord),
    ).rejects.toBeInstanceOf(PluginDeliveryAttemptPersistenceValidationError);
    expect(client.calls).toHaveLength(0);
  });

  it('fails closed when the durable idempotency winner is absent, ambiguous, or corrupt', async () => {
    const resultCases = [
      result([]),
      result([row(), row()]),
      result([row({ grant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })]),
    ];

    for (const durableResult of resultCases) {
      const store = new PostgresPluginDeliveryAttemptStore(
        new ScriptedSqlClient([durableResult]),
      );
      await expect(store.createIfAbsent(RECORD)).rejects.toBeInstanceOf(
        PluginDeliveryAttemptPersistenceEvidenceError,
      );
    }
  });
});
