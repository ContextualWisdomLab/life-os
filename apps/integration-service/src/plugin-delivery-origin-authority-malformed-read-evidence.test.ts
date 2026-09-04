import { describe, expect, it } from 'vitest';
import {
  PluginDeliveryOriginAuthority,
  PluginDeliveryOriginAuthorityError,
  type PluginDeliveryOriginGrantRecord,
  type PluginDeliveryOriginGrantStore,
} from './plugin-delivery-origin-authority';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';

function storeFinding(durableEvidence: unknown): PluginDeliveryOriginGrantStore {
  return {
    async createIfAbsent(
      candidate: PluginDeliveryOriginGrantRecord,
    ): Promise<PluginDeliveryOriginGrantRecord> {
      return candidate;
    },
    async findById(): Promise<PluginDeliveryOriginGrantRecord | undefined> {
      return durableEvidence as PluginDeliveryOriginGrantRecord | undefined;
    },
    async revokeActive(): Promise<PluginDeliveryOriginGrantRecord | undefined> {
      return undefined;
    },
  };
}

describe('Plugin delivery-origin read evidence', () => {
  it.each([null, 'malformed', Object.freeze({}), Object.freeze([])])(
    'rejects malformed durable read evidence instead of collapsing %j into not-found',
    async (durableEvidence) => {
      const subject = new PluginDeliveryOriginAuthority(
        storeFinding(durableEvidence),
        {
          async findById() {
            throw new Error('Malformed grant evidence must fail before installation lookup');
          },
        },
      );

      await expect(
        subject.getGrant(
          { workspaceId: WORKSPACE_ID, actorUserId: USER_ID },
          INSTALLATION_ID,
          GRANT_ID,
        ),
      ).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);
    },
  );
});
