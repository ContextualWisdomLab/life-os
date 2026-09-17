import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptStatusApplication,
  PluginDeliveryAttemptStatusAuthorityError,
  type PluginDeliveryAttemptStatusCommand,
  type PluginDeliveryAttemptStatusEvidence,
  type PluginDeliveryAttemptStatusStore,
} from './plugin-delivery-attempt-status';
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
const REQUESTED_AT = '2026-09-09T01:20:00.000Z';
const UPDATED_AT = '2026-09-09T02:55:00.000Z';
const CHECKED_AT = '2026-09-09T03:00:00.000Z';
const IMPOSSIBLE_NEXT_ATTEMPT_AT = '2026-09-09T02:55:31.000Z';

function command(): PluginDeliveryAttemptStatusCommand {
  return {
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    checkedAt: CHECKED_AT,
  };
}

function impossibleScheduledRetry(): PluginDeliveryAttemptStatusEvidence {
  return {
    authorityVersion: 'life-os.plugin-delivery-attempt-status.v1',
    deliveryId: DELIVERY_ID,
    grantId: GRANT_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    deliveryStatus: 'pending',
    attemptCount: 2,
    maxAttempts: 3,
    requestedAt: REQUESTED_AT,
    updatedAt: UPDATED_AT,
    nextAttemptAt: IMPOSSIBLE_NEXT_ATTEMPT_AT,
    terminalAt: null,
    lastOutcomeCode: 'retryable_failure',
    controlSequence: 0,
    claimState: 'unclaimed',
    checkedAt: CHECKED_AT,
  };
}

class ImpossibleRetryStore implements PluginDeliveryAttemptStatusStore {
  async read(): Promise<PluginDeliveryAttemptStatusEvidence> {
    return impossibleScheduledRetry();
  }
}

describe('plugin delivery-attempt status retry-schedule authority', () => {
  it('rejects application evidence with a non-canonical deterministic retry instant', async () => {
    const app = new PluginDeliveryAttemptStatusApplication(
      new ImpossibleRetryStore(),
      () => new Date(CHECKED_AT),
    );

    await expect(
      app.read(
        { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
        DELIVERY_ID,
      ),
    ).rejects.toEqual(new PluginDeliveryAttemptStatusAuthorityError());
  });

  it('rejects persisted unclaimed retry evidence whose schedule cannot be produced by the retry aggregate', async () => {
    const impossibleRow = {
      authority_version: 'life-os.plugin-delivery-attempt.v1',
      delivery_id: DELIVERY_ID,
      grant_id: GRANT_ID,
      installation_id: INSTALLATION_ID,
      workspace_id: WORKSPACE_ID,
      requested_by_user_id: USER_ID,
      delivery_status: 'pending',
      attempt_count: 2,
      max_attempts: 3,
      requested_at: new Date(REQUESTED_AT),
      updated_at: new Date(UPDATED_AT),
      next_attempt_at: new Date(IMPOSSIBLE_NEXT_ATTEMPT_AT),
      terminal_at: null,
      last_outcome_code: 'retryable_failure',
      control_sequence: 0,
      has_claim_token_digest: false,
      claim_started_at: null,
      claim_expires_at: null,
    };
    const client: PluginDeliveryAttemptStatusSqlClient = {
      async query<Row>() {
        return {
          rows: [impossibleRow as unknown as Row],
          rowCount: 1,
        };
      },
    };
    const store = new PostgresPluginDeliveryAttemptStatusStore(client);

    await expect(store.read(command())).rejects.toEqual(
      new PluginDeliveryAttemptStatusPersistenceEvidenceError(),
    );
  });
});
