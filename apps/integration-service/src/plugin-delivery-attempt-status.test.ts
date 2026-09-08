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
const CHECKED_AT = '2026-09-09T03:00:00.000Z';

function evidence(): PluginDeliveryAttemptStatusEvidence {
  return {
    authorityVersion: 'life-os.plugin-delivery-attempt-status.v1',
    deliveryId: DELIVERY_ID,
    grantId: GRANT_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    deliveryStatus: 'pending',
    attemptCount: 1,
    maxAttempts: 3,
    requestedAt: '2026-09-09T01:20:00.000Z',
    updatedAt: '2026-09-09T02:55:00.000Z',
    nextAttemptAt: '2026-09-09T01:20:00.000Z',
    terminalAt: null,
    lastOutcomeCode: null,
    controlSequence: 0,
    claimState: 'active',
    checkedAt: CHECKED_AT,
  };
}

class FakeStore implements PluginDeliveryAttemptStatusStore {
  readonly commands: PluginDeliveryAttemptStatusCommand[] = [];

  constructor(
    private readonly result:
      PluginDeliveryAttemptStatusEvidence | undefined | Error,
  ) {}

  async read(
    command: PluginDeliveryAttemptStatusCommand,
  ): Promise<PluginDeliveryAttemptStatusEvidence | undefined> {
    this.commands.push(command);
    if (this.result instanceof Error) {
      throw this.result;
    }
    return this.result;
  }
}

function context() {
  return { workspaceId: WORKSPACE_ID, actorUserId: USER_ID };
}

function command(): PluginDeliveryAttemptStatusCommand {
  return {
    deliveryId: DELIVERY_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    checkedAt: CHECKED_AT,
  };
}

describe('PluginDeliveryAttemptStatusApplication', () => {
  it('returns one credential-free durable status snapshot in the exact trusted scope', async () => {
    const store = new FakeStore(evidence());
    const app = new PluginDeliveryAttemptStatusApplication(
      store,
      () => new Date(CHECKED_AT),
    );

    await expect(app.read(context(), DELIVERY_ID)).resolves.toEqual(evidence());
    expect(store.commands).toEqual([
      {
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        checkedAt: CHECKED_AT,
      },
    ]);
    expect(Object.keys(evidence())).not.toContain('claimTokenDigest');
  });

  it('fails closed when no scoped durable status exists', async () => {
    const app = new PluginDeliveryAttemptStatusApplication(
      new FakeStore(undefined),
      () => new Date(CHECKED_AT),
    );

    await expect(app.read(context(), DELIVERY_ID)).rejects.toEqual(
      new PluginDeliveryAttemptStatusAuthorityError(),
    );
  });

  it('collapses dependency rejection without reflecting backend detail', async () => {
    const app = new PluginDeliveryAttemptStatusApplication(
      new FakeStore(new Error('database-host=private.internal')),
      () => new Date(CHECKED_AT),
    );

    await expect(app.read(context(), DELIVERY_ID)).rejects.toEqual(
      new PluginDeliveryAttemptStatusAuthorityError(),
    );
  });

  it('rejects lifecycle evidence that the durable aggregate cannot represent', async () => {
    const impossible: PluginDeliveryAttemptStatusEvidence = {
      ...evidence(),
      deliveryStatus: 'failed',
      claimState: 'unclaimed',
    };
    const app = new PluginDeliveryAttemptStatusApplication(
      new FakeStore(impossible),
      () => new Date(CHECKED_AT),
    );

    await expect(app.read(context(), DELIVERY_ID)).rejects.toEqual(
      new PluginDeliveryAttemptStatusAuthorityError(),
    );
  });

  it('rejects durable status updated after the trusted read instant', async () => {
    const futureUpdated: PluginDeliveryAttemptStatusEvidence = {
      ...evidence(),
      updatedAt: '2026-09-09T03:00:01.000Z',
    };
    const app = new PluginDeliveryAttemptStatusApplication(
      new FakeStore(futureUpdated),
      () => new Date(CHECKED_AT),
    );

    await expect(app.read(context(), DELIVERY_ID)).rejects.toEqual(
      new PluginDeliveryAttemptStatusAuthorityError(),
    );
  });
});

describe('PostgresPluginDeliveryAttemptStatusStore hostile evidence', () => {
  it('collapses a revoked SQL rows array instead of leaking a native proxy failure', async () => {
    const revokedRows = Proxy.revocable([], {});
    revokedRows.revoke();
    const client: PluginDeliveryAttemptStatusSqlClient = {
      async query() {
        return {
          rows: revokedRows.proxy,
          rowCount: 0,
        };
      },
    };
    const store = new PostgresPluginDeliveryAttemptStatusStore(client);

    await expect(store.read(command())).rejects.toEqual(
      new PluginDeliveryAttemptStatusPersistenceEvidenceError(),
    );
  });

  it('rejects a durable row updated after the trusted read instant', async () => {
    const futureRow = {
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
      updated_at: new Date('2026-09-09T03:00:01.000Z'),
      next_attempt_at: new Date('2026-09-09T01:20:00.000Z'),
      terminal_at: null,
      last_outcome_code: null,
      control_sequence: 0,
      has_claim_token_digest: true,
      claim_started_at: new Date('2026-09-09T02:55:00.000Z'),
      claim_expires_at: new Date('2026-09-09T03:05:00.000Z'),
    };
    const client: PluginDeliveryAttemptStatusSqlClient = {
      async query<Row>() {
        return {
          rows: [futureRow as unknown as Row],
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
