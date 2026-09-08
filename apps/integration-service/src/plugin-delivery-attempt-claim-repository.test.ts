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

interface Call {
  readonly text: string;
  readonly values: readonly unknown[];
}

class ScriptedClient implements PluginDeliveryAttemptClaimSqlClient {
  readonly calls: Call[] = [];

  constructor(
    private readonly results: PluginDeliveryAttemptClaimSqlResult<
      Record<string, unknown>
    >[],
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PluginDeliveryAttemptClaimSqlResult<Row>> {
    this.calls.push({ text, values });
    const next = this.results.shift();
    if (!next) {
      throw new Error('Unexpected SQL call');
    }
    return next as PluginDeliveryAttemptClaimSqlResult<Row>;
  }
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
    ...overrides,
  };
}

describe('PostgresPluginDeliveryAttemptClaimStore', () => {
  it('atomically increments the bounded attempt counter only for a due unleased pending row', async () => {
    const client = new ScriptedClient([{ rows: [row()], rowCount: 1 }]);
    const store = new PostgresPluginDeliveryAttemptClaimStore(client);

    await expect(store.claimDue(COMMAND)).resolves.toEqual({
      authorityVersion: 'life-os.plugin-delivery-attempt-claim.v1',
      deliveryId: COMMAND.deliveryId,
      workspaceId: COMMAND.workspaceId,
      requestedByUserId: COMMAND.requestedByUserId,
      attemptNumber: 1,
      claimedAt: COMMAND.claimedAt,
      leaseExpiresAt: COMMAND.leaseExpiresAt,
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'UPDATE plugin_integration.plugin_delivery_attempt_record',
    );
    expect(client.calls[0]?.text).toContain(
      'attempt_count = attempt_count + 1',
    );
    expect(client.calls[0]?.text).toContain(
      'next_attempt_at <= $5::timestamptz',
    );
    expect(client.calls[0]?.text).toContain(
      '(claim_expires_at IS NULL OR claim_expires_at <= $5::timestamptz)',
    );
    expect(client.calls[0]?.text).toContain('attempt_count < max_attempts');
    expect(client.calls[0]?.text).toContain('max_attempts, claim_token_digest');
    expect(client.calls[0]?.values).toEqual([
      COMMAND.claimTokenDigest,
      COMMAND.claimedAt,
      COMMAND.leaseExpiresAt,
      COMMAND.deliveryId,
      COMMAND.claimedAt,
      COMMAND.workspaceId,
      COMMAND.requestedByUserId,
    ]);
  });

  it('returns undefined rather than inventing authority when the conditional claim loses', async () => {
    const client = new ScriptedClient([{ rows: [], rowCount: 0 }]);
    const store = new PostgresPluginDeliveryAttemptClaimStore(client);
    await expect(store.claimDue(COMMAND)).resolves.toBeUndefined();
  });

  it('fails closed on hostile command getters before exercising SQL authority', async () => {
    const client = new ScriptedClient([]);
    const store = new PostgresPluginDeliveryAttemptClaimStore(client);
    const hostile = new Proxy(COMMAND, {
      get(target, property, receiver) {
        if (property === 'deliveryId') {
          throw new Error('password=must-not-escape-claim-input');
        }
        return Reflect.get(target, property, receiver);
      },
    });

    await expect(store.claimDue(hostile)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptClaimPersistenceValidationError,
    );
    expect(client.calls).toHaveLength(0);
  });

  it('fails closed on SQL dependency rejection without reflecting database detail', async () => {
    const store = new PostgresPluginDeliveryAttemptClaimStore({
      async query() {
        throw new Error('password=must-not-escape-claim-sql');
      },
    });

    await expect(store.claimDue(COMMAND)).rejects.toBeInstanceOf(
      PluginDeliveryAttemptClaimPersistenceEvidenceError,
    );
  });

  it('fails closed on ambiguous or malformed durable claim evidence', async () => {
    for (const result of [
      { rows: [row(), row()], rowCount: 2 },
      { rows: [row({ attempt_count: 0 })], rowCount: 1 },
      { rows: [row({ attempt_count: 3, max_attempts: 2 })], rowCount: 1 },
      {
        rows: [
          row({
            claim_token_digest:
              'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          }),
        ],
        rowCount: 1,
      },
      {
        rows: [row({ claim_expires_at: new Date(COMMAND.claimedAt) })],
        rowCount: 1,
      },
    ]) {
      const store = new PostgresPluginDeliveryAttemptClaimStore(
        new ScriptedClient([result]),
      );
      await expect(store.claimDue(COMMAND)).rejects.toBeInstanceOf(
        PluginDeliveryAttemptClaimPersistenceEvidenceError,
      );
    }
  });
});
