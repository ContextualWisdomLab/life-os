import { describe, expect, it } from 'vitest';
import {
  PostgresPluginDeliveryAttemptRetryStore,
  type PluginDeliveryAttemptRetrySqlClient,
} from './plugin-delivery-attempt-retry-repository';

const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const CLAIM_DIGEST = 'a'.repeat(64);
const OCCURRED_AT = '2026-09-08T13:00:00.000Z';

class RecordingClient implements PluginDeliveryAttemptRetrySqlClient {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];

  constructor(
    private readonly result: {
      rows: readonly Record<string, unknown>[];
      rowCount: number | null;
    },
  ) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{
    readonly rows: readonly Row[];
    readonly rowCount: number | null;
  }> {
    this.calls.push({ text, values });
    return this.result as {
      readonly rows: readonly Row[];
      readonly rowCount: number | null;
    };
  }
}

describe('PostgresPluginDeliveryAttemptRetryStore', () => {
  it('consumes only the exact active claim and schedules deterministic backoff', async () => {
    const client = new RecordingClient({
      rowCount: 1,
      rows: [
        {
          authority_version: 'life-os.plugin-delivery-attempt.v1',
          delivery_id: DELIVERY_ID,
          workspace_id: WORKSPACE_ID,
          requested_by_user_id: USER_ID,
          attempt_count: 1,
          max_attempts: 2,
          delivery_status: 'pending',
          updated_at: new Date(OCCURRED_AT),
          next_attempt_at: new Date('2026-09-08T13:00:30.000Z'),
          terminal_at: null,
          last_outcome_code: 'retryable_failure',
          claim_token_digest: null,
          claim_started_at: null,
          claim_expires_at: null,
        },
      ],
    });
    const store = new PostgresPluginDeliveryAttemptRetryStore(client);

    await expect(
      store.recordRetryableFailure({
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        claimTokenDigest: CLAIM_DIGEST,
        occurredAt: OCCURRED_AT,
      }),
    ).resolves.toEqual({
      authorityVersion: 'life-os.plugin-delivery-attempt-retry.v1',
      deliveryId: DELIVERY_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: USER_ID,
      attemptNumber: 1,
      deliveryStatus: 'pending',
      occurredAt: OCCURRED_AT,
      nextAttemptAt: '2026-09-08T13:00:30.000Z',
      terminalAt: null,
      outcomeCode: 'retryable_failure',
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain('claim_token_digest = $1');
    expect(client.calls[0]?.text).toContain(
      'claim_expires_at > $2::timestamptz',
    );
    expect(client.calls[0]?.text).toContain('last_outcome_code = CASE');
    expect(client.calls[0]?.text).toContain('claim_token_digest = NULL');
    expect(client.calls[0]?.values).toEqual([
      CLAIM_DIGEST,
      OCCURRED_AT,
      DELIVERY_ID,
      WORKSPACE_ID,
      USER_ID,
    ]);
  });

  it('returns undefined when the active claim cannot be consumed', async () => {
    const store = new PostgresPluginDeliveryAttemptRetryStore(
      new RecordingClient({ rows: [], rowCount: 0 }),
    );
    await expect(
      store.recordRetryableFailure({
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        claimTokenDigest: CLAIM_DIGEST,
        occurredAt: OCCURRED_AT,
      }),
    ).resolves.toBeUndefined();
  });
});
