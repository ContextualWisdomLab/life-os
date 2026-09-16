import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptStatusPersistenceValidationError,
  PostgresPluginDeliveryAttemptStatusStore,
  type PluginDeliveryAttemptStatusSqlClient,
} from './plugin-delivery-attempt-status-repository';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CHECKED_AT = '2026-09-09T03:00:00.000Z';

function durableRow(): Record<string, unknown> {
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
  };
}

describe('PostgresPluginDeliveryAttemptStatusStore hostile row collection', () => {
  it('rejects a revoked status command before issuing SQL', async () => {
    let queries = 0;
    const client: PluginDeliveryAttemptStatusSqlClient = {
      async query<Row>() {
        queries += 1;
        return { rows: [] as readonly Row[], rowCount: 0 };
      },
    };
    const revocable = Proxy.revocable(
      {
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        checkedAt: CHECKED_AT,
      },
      {},
    );
    revocable.revoke();
    const store = new PostgresPluginDeliveryAttemptStatusStore(client);

    await expect(store.read(revocable.proxy)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptStatusPersistenceValidationError,
    );
    expect(queries).toBe(0);
  });

  it('does not admit a row that appears after zero-row cardinality was observed', async () => {
    let lengthReads = 0;
    const changingRows = new Proxy([] as Record<string, unknown>[], {
      get(target, property, receiver) {
        if (property === 'length') {
          lengthReads += 1;
          return lengthReads === 1 ? 0 : 1;
        }
        if (property === '0') return durableRow();
        return Reflect.get(target, property, receiver);
      },
    });
    const client: PluginDeliveryAttemptStatusSqlClient = {
      async query<Row>() {
        return {
          rows: changingRows as unknown as readonly Row[],
          rowCount: 0,
        };
      },
    };
    const store = new PostgresPluginDeliveryAttemptStatusStore(client);

    await expect(
      store.read({
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        checkedAt: CHECKED_AT,
      }),
    ).resolves.toBeUndefined();
    expect(lengthReads).toBe(1);
  });
});
