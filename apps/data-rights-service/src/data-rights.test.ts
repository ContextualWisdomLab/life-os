import { describe, expect, it } from 'vitest';
import {
  type DataRightsDomain,
  DataRightsConflictError,
  DataRightsCoordinator,
  DataRightsDependencyError,
  type DataRightsParticipant,
  DataRightsValidationError,
  REQUIRED_DATA_RIGHTS_DOMAINS,
} from './data-rights';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_ID = '33333333-3333-4333-8333-333333333333';

interface ParticipantOptions {
  readonly records?: readonly unknown[];
  readonly failPrepare?: boolean;
  readonly failCommit?: boolean;
  readonly counters?: {
    prepare: number;
    commit: number;
  };
}

function participant(
  domain: DataRightsDomain,
  options: ParticipantOptions = {},
): DataRightsParticipant {
  const counters = options.counters;
  return {
    domain,
    schemaVersion: `${domain}.v1`,
    async exportWorkspace(workspaceId) {
      expect(workspaceId).toBe(WORKSPACE_ID);
      return options.records ?? [
        { id: `${domain}-b`, value: 2 },
        { value: 1, id: `${domain}-a` },
      ];
    },
    async prepareDeletion(workspaceId, requestId) {
      counters && (counters.prepare += 1);
      if (options.failPrepare) {
        throw new Error('secret prepare failure');
      }
      return {
        workspaceId,
        requestId,
        token: `${domain}-prepared`,
      };
    },
    async commitDeletion(preparation) {
      counters && (counters.commit += 1);
      if (options.failCommit) {
        throw new Error('secret commit failure');
      }
      return {
        workspaceId: preparation.workspaceId,
        requestId: preparation.requestId,
        deletedRecordCount: 2,
      };
    },
  };
}

function participants(
  overrides: Partial<Record<DataRightsDomain, ParticipantOptions>> = {},
): DataRightsParticipant[] {
  return REQUIRED_DATA_RIGHTS_DOMAINS.map((domain) =>
    participant(domain, overrides[domain]),
  );
}

describe('DataRightsCoordinator export', () => {
  it('creates a complete deterministic tenant export with per-domain digests', async () => {
    const coordinator = new DataRightsCoordinator(
      participants(),
      () => new Date('2026-08-04T00:00:00.000Z'),
    );

    const first = await coordinator.exportWorkspace(WORKSPACE_ID);
    const second = await coordinator.exportWorkspace(WORKSPACE_ID);

    expect(first).toEqual(second);
    expect(first.format).toBe('life-os-portable-data-v1');
    expect(first.sections.map((section) => section.domain)).toEqual(
      REQUIRED_DATA_RIGHTS_DOMAINS,
    );
    expect(first.sections.every((section) => section.recordCount === 2)).toBe(
      true,
    );
    expect(first.sections.every((section) => /^[0-9a-f]{64}$/.test(section.contentDigest))).toBe(true);
    expect(first.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.sections[0]?.records).toEqual([
      { id: 'identity-a', value: 1 },
      { id: 'identity-b', value: 2 },
    ]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.sections)).toBe(true);
  });

  it('requires every domain exactly once and rejects non-JSON participant data', async () => {
    expect(() => new DataRightsCoordinator(participants().slice(1))).toThrow(
      DataRightsValidationError,
    );
    expect(
      () =>
        new DataRightsCoordinator([
          ...participants(),
          participant('identity'),
        ]),
    ).toThrow(DataRightsValidationError);

    const invalidParticipants = participants({
      identity: { records: [new Date()] },
    });
    await expect(
      new DataRightsCoordinator(invalidParticipants).exportWorkspace(
        WORKSPACE_ID,
      ),
    ).rejects.toBeInstanceOf(DataRightsValidationError);
  });
});

describe('DataRightsCoordinator deletion', () => {
  it('prepares every participant before committing and returns an immutable receipt', async () => {
    const counters = { prepare: 0, commit: 0 };
    const coordinator = new DataRightsCoordinator(
      participants(
        Object.fromEntries(
          REQUIRED_DATA_RIGHTS_DOMAINS.map((domain) => [domain, { counters }]),
        ) as Partial<Record<DataRightsDomain, ParticipantOptions>>,
      ),
      () => new Date('2026-08-04T00:00:00.000Z'),
    );

    const receipt = await coordinator.deleteWorkspace(WORKSPACE_ID, REQUEST_ID);

    expect(receipt).toMatchObject({
      status: 'complete',
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      completedAt: '2026-08-04T00:00:00.000Z',
    });
    expect(receipt.status === 'complete' && receipt.domains).toHaveLength(
      REQUIRED_DATA_RIGHTS_DOMAINS.length,
    );
    expect(receipt.status === 'complete' && receipt.receiptDigest).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(counters).toEqual({
      prepare: REQUIRED_DATA_RIGHTS_DOMAINS.length,
      commit: REQUIRED_DATA_RIGHTS_DOMAINS.length,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
  });

  it('performs no commits when any participant cannot prepare', async () => {
    const counters = { prepare: 0, commit: 0 };
    const configured = Object.fromEntries(
      REQUIRED_DATA_RIGHTS_DOMAINS.map((domain) => [domain, { counters }]),
    ) as Partial<Record<DataRightsDomain, ParticipantOptions>>;
    configured.review = { counters, failPrepare: true };
    const coordinator = new DataRightsCoordinator(participants(configured));

    await expect(
      coordinator.deleteWorkspace(WORKSPACE_ID, REQUEST_ID),
    ).rejects.toBeInstanceOf(DataRightsDependencyError);
    expect(counters.commit).toBe(0);
  });

  it('returns a non-completion result after a partial commit and replays it exactly', async () => {
    const counters = { prepare: 0, commit: 0 };
    const configured = Object.fromEntries(
      REQUIRED_DATA_RIGHTS_DOMAINS.map((domain) => [domain, { counters }]),
    ) as Partial<Record<DataRightsDomain, ParticipantOptions>>;
    configured.review = { counters, failCommit: true };
    const coordinator = new DataRightsCoordinator(participants(configured));

    const first = await coordinator.deleteWorkspace(WORKSPACE_ID, REQUEST_ID);
    const firstCounters = { ...counters };
    const replay = await coordinator.deleteWorkspace(WORKSPACE_ID, REQUEST_ID);

    expect(first).toEqual({
      status: 'pending_reconciliation',
      workspaceId: WORKSPACE_ID,
      requestId: REQUEST_ID,
      committedDomains: ['identity', 'planning', 'habit'],
      pendingDomains: ['review', 'ai_audit', 'calendar', 'notification'],
    });
    expect(replay).toBe(first);
    expect(counters).toEqual(firstCounters);
  });

  it('serializes concurrent replays and rejects cross-tenant request reuse', async () => {
    const counters = { prepare: 0, commit: 0 };
    const configured = Object.fromEntries(
      REQUIRED_DATA_RIGHTS_DOMAINS.map((domain) => [domain, { counters }]),
    ) as Partial<Record<DataRightsDomain, ParticipantOptions>>;
    const coordinator = new DataRightsCoordinator(participants(configured));

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        coordinator.deleteWorkspace(WORKSPACE_ID, REQUEST_ID),
      ),
    );

    expect(results.every((result) => result === results[0])).toBe(true);
    expect(counters.commit).toBe(REQUIRED_DATA_RIGHTS_DOMAINS.length);
    await expect(
      coordinator.deleteWorkspace(OTHER_WORKSPACE_ID, REQUEST_ID),
    ).rejects.toBeInstanceOf(DataRightsConflictError);
  });
});
