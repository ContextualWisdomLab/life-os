import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptExecutionFencePersistenceEvidenceError,
  PostgresPluginDeliveryAttemptExecutionFenceStore,
  type PluginDeliveryAttemptExecutionFenceSqlClient,
} from './plugin-delivery-attempt-execution-fence-repository';
import {
  PluginDeliveryAttemptRetryPersistenceEvidenceError,
  PostgresPluginDeliveryAttemptRetryStore,
  type PluginDeliveryAttemptRetrySqlClient,
} from './plugin-delivery-attempt-retry-repository';
import {
  PluginDeliveryAttemptStatusPersistenceEvidenceError,
  PostgresPluginDeliveryAttemptStatusStore,
  type PluginDeliveryAttemptStatusSqlClient,
} from './plugin-delivery-attempt-status-repository';

const DELIVERY_ID = 'a5555555-5555-4555-8555-555555555555';
const GRANT_ID = 'b1111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = 'c2222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = 'd3333333-3333-4333-8333-333333333333';
const USER_ID = 'e4444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN_DIGEST = 'a'.repeat(64);
const INSTANT = '2026-09-09T03:00:00.000Z';
const IMPOSSIBLE_INSTANT = '2026-02-30T03:00:00.000Z';

function executionFenceClient(): PluginDeliveryAttemptExecutionFenceSqlClient {
  return {
    async query<Row>() {
      return {
        rows: [
          {
            authority_version:
              'life-os.plugin-delivery-attempt-execution-fence.v1',
            delivery_id: DELIVERY_ID,
            grant_id: GRANT_ID,
            installation_id: INSTALLATION_ID,
            workspace_id: WORKSPACE_ID,
            requested_by_user_id: USER_ID,
            attempt_count: 1,
            checked_at: IMPOSSIBLE_INSTANT,
            claim_expires_at: '2026-09-09T03:05:00.000Z',
          } as Row,
        ],
        rowCount: 1,
      };
    },
  };
}

function retryClient(): PluginDeliveryAttemptRetrySqlClient {
  return {
    async query<Row>() {
      return {
        rows: [
          {
            authority_version: 'life-os.plugin-delivery-attempt.v1',
            delivery_id: DELIVERY_ID,
            workspace_id: WORKSPACE_ID,
            requested_by_user_id: USER_ID,
            attempt_count: 1,
            max_attempts: 2,
            delivery_status: 'pending',
            updated_at: IMPOSSIBLE_INSTANT,
            next_attempt_at: '2026-09-09T03:00:30.000Z',
            terminal_at: null,
            last_outcome_code: 'retryable_failure',
            claim_token_digest: null,
            claim_started_at: null,
            claim_expires_at: null,
          } as Row,
        ],
        rowCount: 1,
      };
    },
  };
}

function statusClient(): PluginDeliveryAttemptStatusSqlClient {
  return {
    async query<Row>() {
      return {
        rows: [
          {
            authority_version: 'life-os.plugin-delivery-attempt.v1',
            delivery_id: DELIVERY_ID,
            grant_id: GRANT_ID,
            installation_id: INSTALLATION_ID,
            workspace_id: WORKSPACE_ID,
            requested_by_user_id: USER_ID,
            delivery_status: 'pending',
            attempt_count: 1,
            max_attempts: 3,
            requested_at: IMPOSSIBLE_INSTANT,
            updated_at: '2026-09-09T02:55:00.000Z',
            next_attempt_at: '2026-09-09T03:00:00.000Z',
            terminal_at: null,
            last_outcome_code: null,
            control_sequence: 0,
            has_claim_token_digest: true,
            claim_started_at: '2026-09-09T02:55:00.000Z',
            claim_expires_at: '2026-09-09T03:05:00.000Z',
          } as Row,
        ],
        rowCount: 1,
      };
    },
  };
}

describe('persisted delivery instant canonicality', () => {
  it('rejects calendar-invalid execution-fence instants that match the wire shape', async () => {
    const store = new PostgresPluginDeliveryAttemptExecutionFenceStore(
      executionFenceClient(),
    );

    await expect(
      store.check({
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        claimTokenDigest: CLAIM_TOKEN_DIGEST,
        checkedAt: INSTANT,
      }),
    ).rejects.toEqual(
      new PluginDeliveryAttemptExecutionFencePersistenceEvidenceError(),
    );
  });

  it('rejects calendar-invalid retry instants that match the wire shape', async () => {
    const store = new PostgresPluginDeliveryAttemptRetryStore(retryClient());

    await expect(
      store.recordRetryableFailure({
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        claimTokenDigest: CLAIM_TOKEN_DIGEST,
        occurredAt: INSTANT,
      }),
    ).rejects.toEqual(
      new PluginDeliveryAttemptRetryPersistenceEvidenceError(),
    );
  });

  it('rejects calendar-invalid status instants that match the wire shape', async () => {
    const store = new PostgresPluginDeliveryAttemptStatusStore(statusClient());

    await expect(
      store.read({
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        checkedAt: INSTANT,
      }),
    ).rejects.toEqual(
      new PluginDeliveryAttemptStatusPersistenceEvidenceError(),
    );
  });
});
