import { describe, expect, it } from 'vitest';
import type { PluginDeliveryAttemptRecord } from './plugin-delivery-attempt';
import {
  PluginDeliveryAttemptPersistenceEvidenceError,
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
  updatedAt: '2026-09-08T04:41:00.000Z',
  nextAttemptAt: '2026-09-08T04:45:00.000Z',
  terminalAt: null,
  lastOutcomeCode: null,
});

function row(): Record<string, unknown> {
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
    terminal_at: null,
    last_outcome_code: null,
  };
}

class ScriptedSqlClient implements PluginDeliveryAttemptSqlClient {
  readonly calls: string[] = [];

  constructor(private readonly results: PluginDeliveryAttemptSqlResult<Record<string, unknown>>[]) {}

  async query<Row>(text: string): Promise<PluginDeliveryAttemptSqlResult<Row>> {
    this.calls.push(text);
    const next = this.results.shift();
    if (!next) throw new Error('Unexpected SQL call');
    return next as PluginDeliveryAttemptSqlResult<Row>;
  }
}

describe('PostgresPluginDeliveryAttemptStore hostile row collections', () => {
  it('rejects a revoked row-array proxy as fixed persistence evidence failure', async () => {
    const revocable = Proxy.revocable([row()], {});
    revocable.revoke();
    const client = new ScriptedSqlClient([
      {
        rows: revocable.proxy,
        rowCount: 1,
      } as PluginDeliveryAttemptSqlResult<Record<string, unknown>>,
    ]);
    const store = new PostgresPluginDeliveryAttemptStore(client);

    await expect(store.createIfAbsent(RECORD)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptPersistenceEvidenceError,
    );
  });

  it('does not admit a row that appears after zero-row cardinality was observed', async () => {
    let lengthReads = 0;
    const changingRows = new Proxy([] as Record<string, unknown>[], {
      get(target, property, receiver) {
        if (property === 'length') {
          lengthReads += 1;
          return lengthReads === 1 ? 0 : 1;
        }
        if (property === '0') return row();
        return Reflect.get(target, property, receiver);
      },
    });
    const client = new ScriptedSqlClient([
      { rows: changingRows, rowCount: 0 },
      { rows: [], rowCount: 0 },
    ]);
    const store = new PostgresPluginDeliveryAttemptStore(client);

    await expect(store.createIfAbsent(RECORD)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptPersistenceEvidenceError,
    );
    expect(lengthReads).toBe(1);
    expect(client.calls).toHaveLength(2);
  });
});
