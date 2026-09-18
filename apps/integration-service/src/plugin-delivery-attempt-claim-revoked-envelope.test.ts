import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptClaimPersistenceEvidenceError,
  PluginDeliveryAttemptClaimPersistenceValidationError,
  PostgresPluginDeliveryAttemptClaimStore,
  type PluginDeliveryAttemptClaimSqlClient,
  type PluginDeliveryAttemptClaimSqlResult,
} from './plugin-delivery-attempt-claim-repository';

const COMMAND = Object.freeze({
  deliveryId: '55555555-5555-4555-8555-555555555555',
  workspaceId: '33333333-3333-4333-8333-333333333333',
  requestedByUserId: '44444444-4444-4444-8444-444444444444',
  claimTokenDigest:
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  claimedAt: '2026-09-08T10:30:00.000Z',
  leaseExpiresAt: '2026-09-08T10:31:00.000Z',
});

function durableRow(): Record<string, unknown> {
  return {
    authority_version: 'life-os.plugin-delivery-attempt.v1',
    delivery_id: COMMAND.deliveryId,
    workspace_id: COMMAND.workspaceId,
    requested_by_user_id: COMMAND.requestedByUserId,
    attempt_count: 1,
    max_attempts: 4,
    claim_token_digest: COMMAND.claimTokenDigest,
    claim_started_at: new Date(COMMAND.claimedAt),
    claim_expires_at: new Date(COMMAND.leaseExpiresAt),
  };
}

class FixedClient implements PluginDeliveryAttemptClaimSqlClient {
  constructor(
    private readonly result: PluginDeliveryAttemptClaimSqlResult<unknown>,
  ) {}

  async query<Row>(): Promise<PluginDeliveryAttemptClaimSqlResult<Row>> {
    return this.result as PluginDeliveryAttemptClaimSqlResult<Row>;
  }
}

describe('PostgresPluginDeliveryAttemptClaimStore revoked-envelope boundary', () => {
  it('collapses a revoked command proxy before SQL authority is exercised', async () => {
    let calls = 0;
    const store = new PostgresPluginDeliveryAttemptClaimStore({
      async query() {
        calls += 1;
        return { rows: [], rowCount: 0 };
      },
    });
    const revoked = Proxy.revocable(COMMAND, {});
    revoked.revoke();

    await expect(store.claimDue(revoked.proxy)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptClaimPersistenceValidationError,
    );
    expect(calls).toBe(0);
  });

  it('collapses a revoked SQL row-array proxy to the fixed evidence error', async () => {
    const revokedRows = Proxy.revocable([durableRow()], {});
    revokedRows.revoke();
    const store = new PostgresPluginDeliveryAttemptClaimStore(
      new FixedClient({ rows: revokedRows.proxy, rowCount: 1 }),
    );

    await expect(store.claimDue(COMMAND)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptClaimPersistenceEvidenceError,
    );
  });

  it('collapses a revoked SQL row proxy to the fixed evidence error', async () => {
    const revokedRow = Proxy.revocable(durableRow(), {});
    revokedRow.revoke();
    const store = new PostgresPluginDeliveryAttemptClaimStore(
      new FixedClient({ rows: [revokedRow.proxy], rowCount: 1 }),
    );

    await expect(store.claimDue(COMMAND)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptClaimPersistenceEvidenceError,
    );
  });
});
