import { describe, expect, it } from 'vitest';
import type { PluginDeliveryAttemptRetryCommand } from './plugin-delivery-attempt-retry';
import {
  PluginDeliveryAttemptRetryPersistenceEvidenceError,
  PluginDeliveryAttemptRetryPersistenceValidationError,
  PostgresPluginDeliveryAttemptRetryStore,
  type PluginDeliveryAttemptRetrySqlClient,
  type PluginDeliveryAttemptRetrySqlResult,
} from './plugin-delivery-attempt-retry-repository';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN_DIGEST = 'a'.repeat(64);
const OCCURRED_AT = '2026-09-09T02:00:00.000Z';

function command(): PluginDeliveryAttemptRetryCommand {
  return {
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    claimTokenDigest: CLAIM_TOKEN_DIGEST,
    occurredAt: OCCURRED_AT,
  };
}

function pendingRow(attemptNumber = 1, maxAttempts = 2) {
  const delaySeconds = Math.min(30 * 2 ** Math.max(0, attemptNumber - 1), 900);
  return {
    authority_version: 'life-os.plugin-delivery-attempt.v1',
    delivery_id: DELIVERY_ID,
    workspace_id: WORKSPACE_ID,
    requested_by_user_id: USER_ID,
    attempt_count: attemptNumber,
    max_attempts: maxAttempts,
    delivery_status: 'pending',
    updated_at: new Date(OCCURRED_AT),
    next_attempt_at: new Date(
      new Date(OCCURRED_AT).getTime() + delaySeconds * 1_000,
    ),
    terminal_at: null,
    last_outcome_code: 'retryable_failure',
    claim_token_digest: null,
    claim_started_at: null,
    claim_expires_at: null,
  };
}

function terminalRow() {
  return {
    ...pendingRow(2, 2),
    delivery_status: 'failed',
    next_attempt_at: null,
    terminal_at: new Date(OCCURRED_AT),
    last_outcome_code: 'attempt_limit',
  };
}

function harness(result: unknown) {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> =
    [];
  const client: PluginDeliveryAttemptRetrySqlClient = {
    async query<Row>(text: string, values?: readonly unknown[]) {
      calls.push({ text, values });
      if (result instanceof Error) {
        throw result;
      }
      return result as PluginDeliveryAttemptRetrySqlResult<Row>;
    },
  };
  return {
    store: new PostgresPluginDeliveryAttemptRetryStore(client),
    calls,
  };
}

function oneRow(value: unknown) {
  return { rows: [value], rowCount: 1 };
}

describe('PostgresPluginDeliveryAttemptRetryStore', () => {
  it('returns deterministic retry evidence and binds only scoped transition values', async () => {
    const { store, calls } = harness(oneRow(pendingRow()));

    await expect(store.recordRetryableFailure(command())).resolves.toEqual({
      authorityVersion: 'life-os.plugin-delivery-attempt-retry.v1',
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      attemptNumber: 1,
      maxAttempts: 2,
      deliveryStatus: 'pending',
      occurredAt: OCCURRED_AT,
      nextAttemptAt: '2026-09-09T02:00:30.000Z',
      terminalAt: null,
      outcomeCode: 'retryable_failure',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('claim_token_digest = $1');
    expect(calls[0]?.text).toContain('claim_expires_at > $2::timestamptz');
    expect(calls[0]?.text).toContain('last_outcome_code = CASE');
    expect(calls[0]?.text).toContain('claim_token_digest = NULL');
    expect(calls[0]?.values).toEqual([
      CLAIM_TOKEN_DIGEST,
      OCCURRED_AT,
      DELIVERY_ID,
      WORKSPACE_ID,
      USER_ID,
    ]);
  });

  it('caps exponential retry delay at fifteen minutes', async () => {
    const { store } = harness(oneRow(pendingRow(6, 7)));
    await expect(
      store.recordRetryableFailure(command()),
    ).resolves.toMatchObject({
      attemptNumber: 6,
      maxAttempts: 7,
      nextAttemptAt: '2026-09-09T02:15:00.000Z',
    });
  });

  it('returns terminal exhaustion evidence only at the durable retry limit', async () => {
    const { store } = harness(oneRow(terminalRow()));
    await expect(store.recordRetryableFailure(command())).resolves.toEqual({
      authorityVersion: 'life-os.plugin-delivery-attempt-retry.v1',
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      attemptNumber: 2,
      maxAttempts: 2,
      deliveryStatus: 'failed',
      occurredAt: OCCURRED_AT,
      nextAttemptAt: null,
      terminalAt: OCCURRED_AT,
      outcomeCode: 'attempt_limit',
    });
  });

  it('returns undefined only for an unambiguous no-transition result', async () => {
    const { store } = harness({ rows: [], rowCount: 0 });
    await expect(
      store.recordRetryableFailure(command()),
    ).resolves.toBeUndefined();
  });

  it('rejects malformed commands before exercising SQL authority', async () => {
    const revoked = Proxy.revocable(command(), {});
    revoked.revoke();
    const throwing = {
      ...command(),
      get workspaceId(): string {
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
      { ...command(), claimTokenDigest: 7 },
      { ...command(), claimTokenDigest: 'not-a-digest' },
      { ...command(), occurredAt: 7 },
      { ...command(), occurredAt: 'not-an-instant' },
      { ...command(), occurredAt: '2026-02-30T02:00:00.000Z' },
    ];

    for (const invalid of invalidCommands) {
      const { store, calls } = harness(oneRow(pendingRow()));
      await expect(
        store.recordRetryableFailure(
          invalid as PluginDeliveryAttemptRetryCommand,
        ),
      ).rejects.toEqual(
        new PluginDeliveryAttemptRetryPersistenceValidationError(),
      );
      expect(calls).toEqual([]);
    }
  });

  it('collapses SQL dependency rejection without reflecting backend detail', async () => {
    const { store } = harness(new Error('database-host=private.internal'));
    await expect(store.recordRetryableFailure(command())).rejects.toEqual(
      new PluginDeliveryAttemptRetryPersistenceEvidenceError(),
    );
  });

  it('rejects malformed SQL result envelopes', async () => {
    const revokedRows = Proxy.revocable([pendingRow()], {});
    revokedRows.revoke();
    const revokedResult = Proxy.revocable(oneRow(pendingRow()), {});
    revokedResult.revoke();
    const malformedResults: unknown[] = [
      null,
      [],
      revokedResult.proxy,
      { rows: null, rowCount: 0 },
      { rows: revokedRows.proxy, rowCount: 1 },
      { rows: [], rowCount: null },
      { rows: [], rowCount: 0.5 },
      { rows: [], rowCount: -1 },
      { rows: [], rowCount: 1 },
      { rows: [pendingRow(), pendingRow()], rowCount: 2 },
      { rows: [undefined], rowCount: 1 },
    ];

    for (const malformed of malformedResults) {
      const { store } = harness(malformed);
      await expect(store.recordRetryableFailure(command())).rejects.toEqual(
        new PluginDeliveryAttemptRetryPersistenceEvidenceError(),
      );
    }
  });

  it('rejects corrupt durable retry evidence across identity, attempt and chronology invariants', async () => {
    const revokedRow = Proxy.revocable(pendingRow(), {});
    revokedRow.revoke();
    const invalidRows: unknown[] = [
      null,
      [],
      revokedRow.proxy,
      { ...pendingRow(), authority_version: 'unexpected' },
      { ...pendingRow(), delivery_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      { ...pendingRow(), workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      {
        ...pendingRow(),
        requested_by_user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
      { ...pendingRow(), attempt_count: '1' },
      { ...pendingRow(), attempt_count: 0 },
      { ...pendingRow(), max_attempts: '2' },
      { ...pendingRow(), max_attempts: 0 },
      { ...pendingRow(), max_attempts: 11 },
      { ...pendingRow(), attempt_count: 3, max_attempts: 2 },
      { ...pendingRow(), claim_token_digest: CLAIM_TOKEN_DIGEST },
      { ...pendingRow(), claim_started_at: new Date(OCCURRED_AT) },
      { ...pendingRow(), claim_expires_at: new Date(OCCURRED_AT) },
      { ...pendingRow(), updated_at: new Date('invalid') },
      { ...pendingRow(), updated_at: '2026-09-09T02:00:01.000Z' },
      { ...pendingRow(), next_attempt_at: 'not-an-instant' },
      { ...pendingRow(), terminal_at: 'not-an-instant' },
      { ...pendingRow(), delivery_status: 'failed' },
      { ...pendingRow(), last_outcome_code: 'attempt_limit' },
      { ...pendingRow(), terminal_at: new Date(OCCURRED_AT) },
      {
        ...pendingRow(),
        next_attempt_at: new Date('2026-09-09T02:00:31.000Z'),
      },
      { ...terminalRow(), delivery_status: 'pending' },
      { ...terminalRow(), last_outcome_code: 'retryable_failure' },
      { ...terminalRow(), next_attempt_at: new Date(OCCURRED_AT) },
      { ...terminalRow(), terminal_at: null },
      { ...pendingRow(), delivery_id: 'not-a-uuid' },
      { ...pendingRow(), workspace_id: 'not-a-uuid' },
      { ...pendingRow(), requested_by_user_id: 'not-a-uuid' },
    ];

    for (const invalid of invalidRows) {
      const { store } = harness(oneRow(invalid));
      await expect(store.recordRetryableFailure(command())).rejects.toEqual(
        new PluginDeliveryAttemptRetryPersistenceEvidenceError(),
      );
    }
  });
});
