import { describe, expect, it, vi } from 'vitest';
import {
  PluginDeliveryOriginAuthority,
  PluginDeliveryOriginAuthorityError,
} from './plugin-delivery-origin-authority';

const INSTALLATION_ID = '33333333-3333-4333-8333-333333333333';
const GRANT_ID = '44444444-4444-4444-8444-444444444444';

function fixture() {
  const createIfAbsent = vi.fn();
  const findById = vi.fn();
  const revokeActive = vi.fn();
  const findInstallationById = vi.fn();
  return {
    createIfAbsent,
    findById,
    revokeActive,
    findInstallationById,
    subject: new PluginDeliveryOriginAuthority(
      { createIfAbsent, findById, revokeActive },
      { findById: findInstallationById },
      () => new Date('2026-09-03T16:00:00.000Z'),
    ),
  };
}

async function expectBoundedFailure(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(PluginDeliveryOriginAuthorityError);
}

describe('PluginDeliveryOriginAuthority malformed trusted context', () => {
  it.each([null, undefined, 'not-an-object', [], 42])(
    'rejects malformed context before any authority or persistence I/O: %j',
    async (context) => {
      const grant = fixture();
      await expectBoundedFailure(
        grant.subject.grant(
          context as never,
          INSTALLATION_ID,
          { grantId: GRANT_ID, origin: 'https://api.example.com' },
        ),
      );
      expect(grant.findInstallationById).not.toHaveBeenCalled();
      expect(grant.createIfAbsent).not.toHaveBeenCalled();

      const read = fixture();
      await expectBoundedFailure(
        read.subject.getGrant(context as never, INSTALLATION_ID, GRANT_ID),
      );
      expect(read.findById).not.toHaveBeenCalled();
      expect(read.findInstallationById).not.toHaveBeenCalled();

      const revoke = fixture();
      await expectBoundedFailure(
        revoke.subject.revoke(context as never, INSTALLATION_ID, GRANT_ID),
      );
      expect(revoke.revokeActive).not.toHaveBeenCalled();
    },
  );
});
