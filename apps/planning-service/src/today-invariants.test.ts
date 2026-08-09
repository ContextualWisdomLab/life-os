import { describe, expect, it } from 'vitest';
import {
  TODAY_VERSION,
  canonicalTodayDate,
  canonicalTodayDraft,
  canonicalTodayUuidV4,
} from './today-invariants';

class InvariantFailure extends Error {}

function fail(): never {
  throw new InvariantFailure();
}

describe('shared Today invariants', () => {
  it('canonicalizes shared identifier and calendar rules', () => {
    expect(
      canonicalTodayUuidV4('A0EBC2A3-3D39-4B78-88AF-7F952C9049AD', fail),
    ).toBe('a0ebc2a3-3d39-4b78-88af-7f952c9049ad');
    expect(canonicalTodayDate('2026-08-10', fail)).toBe('2026-08-10');
    expect(() => canonicalTodayDate('2026-02-30', fail)).toThrow(
      InvariantFailure,
    );
  });

  it('validates the complete draft once for domain and persistence callers', () => {
    const draft = canonicalTodayDraft(
      {
        version: TODAY_VERSION,
        date: '2026-08-10',
        actions: [
          {
            id: 'f4fd9ff3-d182-4516-a30e-b954c8b44ae2',
            title: '  Finish the review  ',
            status: 'open',
            priority: 1,
            startMinute: 540,
            durationMinutes: 30,
            createdAt: '2026-08-09T21:00:00Z',
            completedAt: null,
          },
        ],
      },
      fail,
      '2026-08-10',
    );

    expect(draft).toEqual({
      version: 'life-os.today.v1',
      date: '2026-08-10',
      actions: [
        {
          id: 'f4fd9ff3-d182-4516-a30e-b954c8b44ae2',
          title: 'Finish the review',
          status: 'open',
          priority: 1,
          startMinute: 540,
          durationMinutes: 30,
          createdAt: '2026-08-09T21:00:00.000Z',
          completedAt: null,
        },
      ],
    });
  });
});
