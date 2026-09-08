import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptStatusPersistenceEvidenceError,
  PostgresPluginDeliveryAttemptStatusStore,
  type PluginDeliveryAttemptStatusSqlClient,
} from './plugin-delivery-attempt-status-repository';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CHECKED_AT = '2026-09-09T03:00:00.000Z';

function command() {
  return {
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    checkedAt: CHECKED_AT,
  };
}

function claimedRow(overrides: Record<string, unknown> = {}) {
  return {
    authority_version: 'life-os.plugin-delivery-attempt.v1',
    delivery_id: DELIVERY_ID,
    grant_id: GRANT_ID,
    installation_id: INSTALLATION_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: USER_ID,
    delivery_status: 'pending',
    attempt_count: 1,
    max_attempts: 3,
    requested_at: new Date('2026-09-09T01:20:00.000Z'),
    updated_at: new Date('2026-09-09T02:55:00.000Z'),
    next_attempt_at: new Date('2026-09-09T01:20:00.000Z'),
    terminal_at: null,
    last_outcome_code: null,
    control_sequence: 0,
    has_claim_token_digest: true,
    claim_started_at: new Date('2026-09-09T02:55:00.000Z'),
    claim_expires_at: new Date('2026-09-09T03:05:00.000Z'),
    ...overrides,
  };
}

function storeFor(row: ReturnType<typeof claimedRow>) {
  const client: PluginDeliveryAttemptStatusSqlClient = {
    async query<Row>() {
      return {
        rows: [row as unknown as Row],
        rowCount: 1,
      };
    },
  };
  return new PostgresPluginDeliveryAttemptStatusStore(client);
}

describe('PostgresPluginDeliveryAttemptStatusStore claim chronology', () => {
  it('rejects a durable claim that starts before the delivery was requested', async () => {
    const store = storeFor(
      claimedRow({
        claim_started_at: new Date('2026-09-09T01:19:59.000Z'),
        claim_expires_at: new Date('2026-09-09T01:20:29.000Z'),
      }),
    );

    await expect(store.read(command())).rejects.toEqual(
      new PluginDeliveryAttemptStatusPersistenceEvidenceError(),
    );
  });

  it('rejects a durable claim that starts after the aggregate update instant', async () => {
    const store = storeFor(
      claimedRow({
        updated_at: new Date('2026-09-09T02:54:59.000Z'),
        claim_started_at: new Date('2026-09-09T02:55:00.000Z'),
      }),
    );

    await expect(store.read(command())).rejects.toEqual(
      new PluginDeliveryAttemptStatusPersistenceEvidenceError(),
    );
  });
});
