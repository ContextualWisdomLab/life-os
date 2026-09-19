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

function storeForResult(result: unknown): PostgresPluginDeliveryAttemptClaimStore {
  const client: PluginDeliveryAttemptClaimSqlClient = {
    async query<Row>(): Promise<PluginDeliveryAttemptClaimSqlResult<Row>> {
      return result as PluginDeliveryAttemptClaimSqlResult<Row>;
    },
  };
  return new PostgresPluginDeliveryAttemptClaimStore(client);
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

  it('rejects malformed command shapes, identities, digests, instants, and lease windows before SQL', async () => {
    const invalidCommands: readonly unknown[] = [
      null,
      [],
      { ...COMMAND, deliveryId: 123 },
      { ...COMMAND, deliveryId: 'not-a-uuid' },
      { ...COMMAND, workspaceId: 'not-a-uuid' },
      { ...COMMAND, requestedByUserId: 'not-a-uuid' },
      { ...COMMAND, claimTokenDigest: 123 },
      { ...COMMAND, claimTokenDigest: 'not-a-digest' },
      { ...COMMAND, claimedAt: 123 },
      { ...COMMAND, claimedAt: 'not-an-instant' },
      { ...COMMAND, claimedAt: '2026-02-31T10:30:00.000Z' },
      { ...COMMAND, leaseExpiresAt: 'not-an-instant' },
      { ...COMMAND, leaseExpiresAt: '2026-02-31T10:31:00.000Z' },
      { ...COMMAND, leaseExpiresAt: '2026-09-08T10:30:29.999Z' },
      { ...COMMAND, leaseExpiresAt: '2026-09-08T11:30:00.001Z' },
    ];

    for (const candidate of invalidCommands) {
      const client = new ScriptedClient([]);
      const store = new PostgresPluginDeliveryAttemptClaimStore(client);
      await expect(store.claimDue(candidate as never)).rejects.toBeInstanceOf(
        PluginDeliveryAttemptClaimPersistenceValidationError,
      );
      expect(client.calls).toHaveLength(0);
    }
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

  it('fails closed when the SQL row-array envelope throws during length or element access', async () => {
    for (const property of ['length', '0']) {
      const rows = new Proxy([row()], {
        get(target, candidate, receiver) {
          if (candidate === property) {
            throw new Error('password=must-not-escape-claim-row-array');
          }
          return Reflect.get(target, candidate, receiver);
        },
      });
      const store = new PostgresPluginDeliveryAttemptClaimStore(
        new ScriptedClient([{ rows, rowCount: 1 }]),
      );

      await expect(store.claimDue(COMMAND)).rejects.toBeInstanceOf(
        PluginDeliveryAttemptClaimPersistenceEvidenceError,
      );
    }
  });

  it('fails closed on malformed SQL result envelopes, including an undefined single row', async () => {
    const revoked = Proxy.revocable({ rows: [row()], rowCount: 1 }, {});
    revoked.revoke();
    const malformedResults: readonly unknown[] = [
      null,
      'not-a-result',
      [],
      revoked.proxy,
      { rows: 'not-an-array', rowCount: 0 },
      { rows: [], rowCount: null },
      { rows: [], rowCount: -1 },
      { rows: [], rowCount: 0.5 },
      { rows: [], rowCount: 1 },
      { rows: [row(), row()], rowCount: 2 },
      { rows: [undefined], rowCount: 1 },
    ];

    for (const result of malformedResults) {
      await expect(
        storeForResult(result).claimDue(COMMAND),
      ).rejects.toBeInstanceOf(
        PluginDeliveryAttemptClaimPersistenceEvidenceError,
      );
    }
  });

  it('fails closed on ambiguous or malformed durable claim evidence', async () => {
    const revoked = Proxy.revocable(row(), {});
    revoked.revoke();
    const malformedRows: readonly unknown[] = [
      null,
      'not-a-row',
      [],
      revoked.proxy,
      row({ authority_version: 'life-os.plugin-delivery-attempt.v2' }),
      row({ delivery_id: '77777777-7777-4777-8777-777777777777' }),
      row({ workspace_id: '77777777-7777-4777-8777-777777777777' }),
      row({ requested_by_user_id: '77777777-7777-4777-8777-777777777777' }),
      row({
        claim_token_digest:
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      }),
      row({ attempt_count: '1' }),
      row({ attempt_count: 1.5 }),
      row({ attempt_count: 0 }),
      row({ max_attempts: '4' }),
      row({ max_attempts: 1.5 }),
      row({ max_attempts: 0 }),
      row({ max_attempts: 11 }),
      row({ attempt_count: 3, max_attempts: 2 }),
      row({ claim_started_at: new Date(Number.NaN) }),
      row({ claim_started_at: 'not-an-instant' }),
      row({ claim_started_at: '2026-02-31T10:30:00.000Z' }),
      row({ claim_started_at: '2026-09-08T10:30:01.000Z' }),
      row({ claim_expires_at: new Date(Number.NaN) }),
      row({ claim_expires_at: 'not-an-instant' }),
      row({ claim_expires_at: '2026-02-31T10:31:00.000Z' }),
      row({ claim_expires_at: '2026-09-08T10:31:01.000Z' }),
    ];

    for (const malformedRow of malformedRows) {
      await expect(
        storeForResult({ rows: [malformedRow], rowCount: 1 }).claimDue(COMMAND),
      ).rejects.toBeInstanceOf(
        PluginDeliveryAttemptClaimPersistenceEvidenceError,
      );
    }
  });
});
