import { describe, expect, it } from 'vitest';
import {
  DataRightsApplication,
  type DataRightsContributor,
  type DataRightsWorkspaceContext,
  type ErasureContributorReceipt,
  type ErasurePreflight,
} from './data-rights';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const FIXED_TIME = new Date('2026-08-10T01:00:00.000Z');

class UnicodeIntegrityContributor implements DataRightsContributor {
  readonly name = 'identity.unicode-data';

  async exportWorkspace(_context: DataRightsWorkspaceContext) {
    return {
      schemaVersion: 'identity.unicode-data.v1',
      recordCount: 2,
      data: { ä: 2, z: 1 },
    } as const;
  }

  async preflightErase(
    _context: DataRightsWorkspaceContext,
  ): Promise<ErasurePreflight> {
    return { ready: true, blockers: [] };
  }

  async eraseWorkspace(
    _context: DataRightsWorkspaceContext & { readonly idempotencyKey: string },
  ): Promise<ErasureContributorReceipt> {
    return { erasedRecords: 0 };
  }

  async verifyWorkspaceErased(
    _context: DataRightsWorkspaceContext,
  ): Promise<boolean> {
    return true;
  }
}

describe('data-rights export integrity serialization', () => {
  it('orders property names by UTF-16 code units instead of locale collation', async () => {
    const exported = await new DataRightsApplication(
      [new UnicodeIntegrityContributor()],
      () => FIXED_TIME,
    ).exportWorkspace({ workspaceId: WORKSPACE_ID, actorUserId: USER_ID });

    expect(exported.sections).toHaveLength(1);
    expect(exported.sections[0]?.sha256).toBe(
      '20cf27b49acce051d1738c1e487ef09566463363d4ac8442b5747d07296c8127',
    );
  });
});
