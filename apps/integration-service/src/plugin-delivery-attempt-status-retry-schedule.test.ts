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
const CANONICAL_NEXT_ATTEMPT_AT = '2026-09-09T02:56:00.000Z';
const IMPOSSIBLE_NEXT_ATTEMPT_AT = '2026-09-09T02:55:31.000Z';

function command(): PluginDeliveryAttemptStatusCommand {
  return {
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    checkedAt: CHECKED_AT,
  };
}

function scheduledRetry(
  nextAttemptAt = CANONICAL_NEXT_ATTEMPT_AT,
  controlSequence = 0,
): PluginDeliveryAttemptStatusEvidence {
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
    nextAttemptAt,
    terminalAt: null,
    lastOutcomeCode: 'retryable_failure',
    controlSequence,
    claimState: 'unclaimed',
    checkedAt: CHECKED_AT,
  };
}

function scheduledRetryRow(
  nextAttemptAt = CANONICAL_NEXT_ATTEMPT_AT,
  controlSequence = 0,
) {
  return {
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
    next_attempt_at: new Date(nextAttemptAt),
    terminal_at: null,
    last_outcome_code: 'retryable_failure',
    control_sequence: controlSequence,
    has_claim_token_digest: false,
    claim_started_at: null,
    claim_expires_at: null,
  };
}

class RetryStore implements PluginDeliveryAttemptStatusStore {
  constructor(private readonly evidence: PluginDeliveryAttemptStatusEvidence) {}

  async read(): Promise<PluginDeliveryAttemptStatusEvidence> {
    return this.evidence;
  }
}

function postgresStore(
  nextAttemptAt = CANONICAL_NEXT_ATTEMPT_AT,
  controlSequence = 0,
): PostgresPluginDeliveryAttemptStatusStore {
  const row = scheduledRetryRow(nextAttemptAt, controlSequence);
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

function application(
  evidence: PluginDeliveryAttemptStatusEvidence,
): PluginDeliveryAttemptStatusApplication {
  return new PluginDeliveryAttemptStatusApplication(
    new RetryStore(evidence),
    () => new Date(CHECKED_AT),
  );
}

function readApplication(app: PluginDeliveryAttemptStatusApplication) {
  return app.read(
    { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
    DELIVERY_ID,
  );
}

describe('plugin delivery-attempt status retry-schedule authority', () => {
  it('rejects application evidence with a non-canonical deterministic retry instant', async () => {
    await expect(
      readApplication(application(scheduledRetry(IMPOSSIBLE_NEXT_ATTEMPT_AT))),
    ).rejects.toEqual(new PluginDeliveryAttemptStatusAuthorityError());
  });

  it('accepts application evidence carrying the retry aggregate deterministic instant', async () => {
    const evidence = scheduledRetry();

    await expect(readApplication(application(evidence))).resolves.toEqual(
      evidence,
    );
  });

  it('preserves a control-transition schedule instead of reapplying aggregate backoff', async () => {
    const resumed = scheduledRetry(UPDATED_AT, 1);

    await expect(readApplication(application(resumed))).resolves.toEqual(
      resumed,
    );
  });

  it('rejects persisted unclaimed retry evidence whose schedule cannot be produced by the retry aggregate', async () => {
    await expect(
      postgresStore(IMPOSSIBLE_NEXT_ATTEMPT_AT).read(command()),
    ).rejects.toEqual(
      new PluginDeliveryAttemptStatusPersistenceEvidenceError(),
    );
  });

  it('accepts persisted no-control retry evidence with the canonical deterministic instant', async () => {
    await expect(postgresStore().read(command())).resolves.toMatchObject({
      nextAttemptAt: CANONICAL_NEXT_ATTEMPT_AT,
      controlSequence: 0,
      claimState: 'unclaimed',
    });
  });

  it('preserves persisted control-transition timing without requiring aggregate backoff', async () => {
    await expect(
      postgresStore(UPDATED_AT, 1).read(command()),
    ).resolves.toMatchObject({
      nextAttemptAt: UPDATED_AT,
      controlSequence: 1,
      claimState: 'unclaimed',
    });
  });
});
