import { describe, expect, it } from 'vitest';
import type { PluginDeliveryAttemptStatusCommand } from './plugin-delivery-attempt-status';
import {
  PluginDeliveryAttemptStatusPersistenceEvidenceError,
  PluginDeliveryAttemptStatusPersistenceValidationError,
  PostgresPluginDeliveryAttemptStatusStore,
  type PluginDeliveryAttemptStatusSqlClient,
  type PluginDeliveryAttemptStatusSqlResult,
} from './plugin-delivery-attempt-status-repository';

const DELIVERY_ID = 'a5555555-5555-4555-8555-555555555555';
const GRANT_ID = 'b1111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = 'c2222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = 'd3333333-3333-4333-8333-333333333333';
const USER_ID = 'e4444444-4444-4444-8444-444444444444';
const REQUESTED_AT = '2026-09-09T01:20:00.000Z';
const UPDATED_AT = '2026-09-09T02:55:00.000Z';
const CHECKED_AT = '2026-09-09T03:00:00.000Z';

function command(checkedAt = CHECKED_AT): PluginDeliveryAttemptStatusCommand {
  return {
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    checkedAt,
  };
}

function activeRow() {
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
    requested_at: new Date(REQUESTED_AT),
    updated_at: new Date(UPDATED_AT),
    next_attempt_at: new Date(REQUESTED_AT),
    terminal_at: null,
    last_outcome_code: null,
    control_sequence: 0,
    has_claim_token_digest: true,
    claim_started_at: new Date(UPDATED_AT),
    claim_expires_at: new Date('2026-09-09T03:05:00.000Z'),
  };
}

function harness(result: unknown) {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> =
    [];
  const client: PluginDeliveryAttemptStatusSqlClient = {
    async query<Row>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      return result as PluginDeliveryAttemptStatusSqlResult<Row>;
    },
  };
  return {
    store: new PostgresPluginDeliveryAttemptStatusStore(client),
    calls,
  };
}

function oneRow(value: unknown) {
  return { rows: [value], rowCount: 1 };
}

describe('PostgresPluginDeliveryAttemptStatusStore coverage boundaries', () => {
  it('normalizes trusted input UUIDs and returns exact credential-free status evidence', async () => {
    const { store, calls } = harness(oneRow(activeRow()));
    const upper = {
      ...command(),
      deliveryId: DELIVERY_ID.toUpperCase(),
      workspaceId: WORKSPACE_ID.toUpperCase(),
      requestedByUserId: USER_ID.toUpperCase(),
    };

    await expect(store.read(upper)).resolves.toMatchObject({
      authorityVersion: 'life-os.plugin-delivery-attempt-status.v1',
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      claimState: 'active',
      checkedAt: CHECKED_AT,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('LIMIT 2');
    expect(calls[0]?.values).toEqual([DELIVERY_ID, WORKSPACE_ID, USER_ID]);
  });

  it('returns undefined only for an unambiguous empty scoped result', async () => {
    const { store } = harness({ rows: [], rowCount: 0 });
    await expect(store.read(command())).resolves.toBeUndefined();
  });

  it('accepts every durable lifecycle shape admitted by the aggregate', async () => {
    const shapes = [
      {
        ...activeRow(),
        attempt_count: 0,
        has_claim_token_digest: false,
        claim_started_at: null,
        claim_expires_at: null,
      },
      activeRow(),
      {
        ...activeRow(),
        has_claim_token_digest: false,
        claim_started_at: null,
        claim_expires_at: null,
        last_outcome_code: 'retryable_failure',
      },
      {
        ...activeRow(),
        delivery_status: 'paused',
        attempt_count: 0,
        has_claim_token_digest: false,
        claim_started_at: null,
        claim_expires_at: null,
      },
      {
        ...activeRow(),
        delivery_status: 'paused',
        has_claim_token_digest: false,
        claim_started_at: null,
        claim_expires_at: null,
        last_outcome_code: 'retryable_failure',
      },
      {
        ...activeRow(),
        delivery_status: 'failed',
        attempt_count: 3,
        next_attempt_at: null,
        terminal_at: new Date(UPDATED_AT),
        last_outcome_code: 'attempt_limit',
        has_claim_token_digest: false,
        claim_started_at: null,
        claim_expires_at: null,
      },
      {
        ...activeRow(),
        delivery_status: 'dead_lettered',
        attempt_count: 3,
        next_attempt_at: null,
        terminal_at: new Date(UPDATED_AT),
        last_outcome_code: 'attempt_limit',
        has_claim_token_digest: false,
        claim_started_at: null,
        claim_expires_at: null,
      },
    ];

    for (const shape of shapes) {
      const { store } = harness(oneRow(shape));
      await expect(store.read(command())).resolves.toBeDefined();
    }
  });

  it('derives an expired claim from the trusted read instant', async () => {
    const checkedAt = '2026-09-09T03:10:00.000Z';
    const { store } = harness(oneRow(activeRow()));
    await expect(store.read(command(checkedAt))).resolves.toMatchObject({
      claimState: 'expired',
      checkedAt,
    });
  });

  it('rejects malformed commands before persistence access', async () => {
    const revoked = Proxy.revocable(command(), {});
    revoked.revoke();
    const throwing = {
      ...command(),
      get checkedAt(): string {
        throw new Error('request-secret');
      },
    };
    const invalidCommands: unknown[] = [
      null,
      [],
      revoked.proxy,
      throwing,
      { ...command(), deliveryId: 7 },
      { ...command(), deliveryId: 'not-a-uuid' },
      { ...command(), workspaceId: 'not-a-uuid' },
      { ...command(), requestedByUserId: 'not-a-uuid' },
      { ...command(), checkedAt: 7 },
      { ...command(), checkedAt: 'not-an-instant' },
      { ...command(), checkedAt: '2026-02-30T03:00:00.000Z' },
    ];

    for (const invalid of invalidCommands) {
      const { store, calls } = harness(oneRow(activeRow()));
      await expect(
        store.read(invalid as PluginDeliveryAttemptStatusCommand),
      ).rejects.toEqual(
        new PluginDeliveryAttemptStatusPersistenceValidationError(),
      );
      expect(calls).toEqual([]);
    }
  });

  it('rejects ambiguous or hostile SQL result envelopes', async () => {
    const revokedRows = Proxy.revocable([activeRow()], {});
    revokedRows.revoke();
    const revokedResult = Proxy.revocable(oneRow(activeRow()), {});
    revokedResult.revoke();
    const malformed: unknown[] = [
      null,
      [],
      revokedResult.proxy,
      { rows: null, rowCount: 0 },
      { rows: revokedRows.proxy, rowCount: 1 },
      { rows: [], rowCount: null },
      { rows: [], rowCount: 0.5 },
      { rows: [], rowCount: -1 },
      { rows: [], rowCount: 1 },
      { rows: [activeRow(), activeRow()], rowCount: 2 },
      { rows: [undefined], rowCount: 1 },
    ];

    for (const result of malformed) {
      const { store } = harness(result);
      await expect(store.read(command())).rejects.toEqual(
        new PluginDeliveryAttemptStatusPersistenceEvidenceError(),
      );
    }
  });

  it('rejects corrupt durable rows across identity, chronology, claim and lifecycle invariants', async () => {
    const revoked = Proxy.revocable(activeRow(), {});
    revoked.revoke();
    const invalidRows: unknown[] = [
      null,
      [],
      revoked.proxy,
      { ...activeRow(), authority_version: 'unexpected' },
      { ...activeRow(), delivery_id: DELIVERY_ID.toUpperCase() },
      { ...activeRow(), grant_id: 'not-a-uuid' },
      { ...activeRow(), installation_id: 'not-a-uuid' },
      { ...activeRow(), workspace_id: 'not-a-uuid' },
      { ...activeRow(), requested_by_user_id: 'not-a-uuid' },
      { ...activeRow(), delivery_status: 'unexpected' },
      { ...activeRow(), last_outcome_code: 'unexpected' },
      { ...activeRow(), max_attempts: 0 },
      { ...activeRow(), max_attempts: 11 },
      { ...activeRow(), attempt_count: -1 },
      { ...activeRow(), attempt_count: 4, max_attempts: 3 },
      { ...activeRow(), control_sequence: -1 },
      { ...activeRow(), requested_at: new Date('invalid') },
      { ...activeRow(), updated_at: 'not-an-instant' },
      { ...activeRow(), updated_at: new Date('2026-09-09T03:00:01.000Z') },
      { ...activeRow(), next_attempt_at: 'not-an-instant' },
      { ...activeRow(), terminal_at: 'not-an-instant' },
      { ...activeRow(), has_claim_token_digest: 'yes' },
      { ...activeRow(), has_claim_token_digest: false },
      {
        ...activeRow(),
        claim_started_at: new Date('2026-09-09T01:19:59.000Z'),
      },
      {
        ...activeRow(),
        claim_started_at: new Date('2026-09-09T02:56:00.000Z'),
      },
      {
        ...activeRow(),
        claim_expires_at: new Date('2026-09-09T02:55:29.999Z'),
      },
      {
        ...activeRow(),
        claim_expires_at: new Date('2026-09-09T03:55:00.001Z'),
      },
      { ...activeRow(), delivery_status: 'failed' },
      { ...activeRow(), next_attempt_at: new Date('2026-09-09T01:19:59.000Z') },
    ];

    for (const invalid of invalidRows) {
      const { store } = harness(oneRow(invalid));
      await expect(store.read(command())).rejects.toEqual(
        new PluginDeliveryAttemptStatusPersistenceEvidenceError(),
      );
    }
  });
});
