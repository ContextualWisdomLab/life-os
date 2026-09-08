import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryAttemptExecutionFenceApplication,
  PluginDeliveryAttemptExecutionFenceAuthorityError,
  type PluginDeliveryAttemptExecutionFenceCommand,
  type PluginDeliveryAttemptExecutionFenceEvidence,
  type PluginDeliveryAttemptExecutionFenceStore,
} from './plugin-delivery-attempt-execution-fence';

const DELIVERY_ID = '55555555-5555-4555-8555-555555555555';
const GRANT_ID = '11111111-1111-4111-8111-111111111111';
const INSTALLATION_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const CLAIM_TOKEN = '66666666-6666-4666-8666-666666666666';
const CHECKED_AT = '2026-09-09T02:00:00.000Z';
const CLAIM_EXPIRES_AT = '2026-09-09T02:05:00.000Z';

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

class FakeStore implements PluginDeliveryAttemptExecutionFenceStore {
  readonly commands: PluginDeliveryAttemptExecutionFenceCommand[] = [];

  constructor(
    private readonly result:
      | PluginDeliveryAttemptExecutionFenceEvidence
      | undefined
      | Error,
  ) {}

  async check(
    command: PluginDeliveryAttemptExecutionFenceCommand,
  ): Promise<PluginDeliveryAttemptExecutionFenceEvidence | undefined> {
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

function evidence(): PluginDeliveryAttemptExecutionFenceEvidence {
  return {
    authorityVersion: 'life-os.plugin-delivery-attempt-execution-fence.v1',
    deliveryId: DELIVERY_ID,
    grantId: GRANT_ID,
    installationId: INSTALLATION_ID,
    workspaceId: WORKSPACE_ID,
    requestedByUserId: USER_ID,
    attemptNumber: 1,
    checkedAt: CHECKED_AT,
    claimExpiresAt: CLAIM_EXPIRES_AT,
  };
}

describe('PluginDeliveryAttemptExecutionFenceApplication', () => {
  it('binds an exact raw claim token to one current execution-fence check', async () => {
    const store = new FakeStore(evidence());
    const app = new PluginDeliveryAttemptExecutionFenceApplication(
      store,
      () => new Date(CHECKED_AT),
    );

    await expect(
      app.check(context(), DELIVERY_ID, CLAIM_TOKEN),
    ).resolves.toEqual(evidence());
    expect(store.commands).toEqual([
      {
        deliveryId: DELIVERY_ID,
        workspaceId: WORKSPACE_ID,
        requestedByUserId: USER_ID,
        claimTokenDigest: digest(CLAIM_TOKEN),
        checkedAt: CHECKED_AT,
      },
    ]);
  });

  it('fails closed when durable authority is absent', async () => {
    const app = new PluginDeliveryAttemptExecutionFenceApplication(
      new FakeStore(undefined),
      () => new Date(CHECKED_AT),
    );

    await expect(app.check(context(), DELIVERY_ID, CLAIM_TOKEN)).rejects.toEqual(
      new PluginDeliveryAttemptExecutionFenceAuthorityError(),
    );
  });

  it('collapses dependency rejection without reflecting backend detail', async () => {
    const app = new PluginDeliveryAttemptExecutionFenceApplication(
      new FakeStore(new Error('database-host=private.internal')),
      () => new Date(CHECKED_AT),
    );

    await expect(app.check(context(), DELIVERY_ID, CLAIM_TOKEN)).rejects.toEqual(
      new PluginDeliveryAttemptExecutionFenceAuthorityError(),
    );
  });
});
