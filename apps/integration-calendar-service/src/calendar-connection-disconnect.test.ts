import { describe, expect, it } from 'vitest';
import type { TrustedCalendarUserContext } from './calendar-service-context';
import {
  CalendarConnectionDisconnectApplication,
  type CalendarConnectionRevocationPort,
} from './calendar-connection-disconnect';
import type {
  CalendarConnectionRevocationRecord,
  RevokeCalendarConnection,
} from './calendar-connection-revocation';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CONNECTION_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const OTHER_USER_ID = '66666666-6666-4666-8666-666666666666';
const REVOKED_AT = '2026-08-10T03:45:00.000Z';
const OTHER_REVOKED_AT = '2026-08-10T03:45:01.000Z';

const AUTHORITY: TrustedCalendarUserContext = Object.freeze({
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
});

class RecordingRevocationPort implements CalendarConnectionRevocationPort {
  readonly calls: RevokeCalendarConnection[] = [];

  constructor(
    private readonly result: CalendarConnectionRevocationRecord | undefined,
  ) {}

  async revokeConnection(
    input: RevokeCalendarConnection,
  ): Promise<CalendarConnectionRevocationRecord | undefined> {
    this.calls.push(input);
    return this.result;
  }
}

function revokedRecord(
  overrides: Partial<CalendarConnectionRevocationRecord> = {},
): CalendarConnectionRevocationRecord {
  return Object.freeze({
    connectionId: CONNECTION_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    status: 'revoked',
    revokedAt: REVOKED_AT,
    ...overrides,
  });
}

describe('CalendarConnectionDisconnectApplication', () => {
  it('derives persistence scope only from trusted workspace-user authority and returns bounded public evidence', async () => {
    const revocations = new RecordingRevocationPort(revokedRecord());
    const application = new CalendarConnectionDisconnectApplication(
      revocations,
      () => new Date(REVOKED_AT),
    );

    await expect(application.disconnect(AUTHORITY, CONNECTION_ID)).resolves.toEqual({
      connectionId: CONNECTION_ID,
      status: 'revoked',
      revokedAt: REVOKED_AT,
    });
    expect(revocations.calls).toEqual([
      {
        connectionId: CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        revokedAt: REVOKED_AT,
      },
    ]);
  });

  it('returns undefined when no connection exists inside the trusted scope', async () => {
    const revocations = new RecordingRevocationPort(undefined);
    const application = new CalendarConnectionDisconnectApplication(
      revocations,
      () => new Date(REVOKED_AT),
    );

    await expect(application.disconnect(AUTHORITY, CONNECTION_ID)).resolves.toBeUndefined();
  });

  it('fails closed for each persistence field that can widen or contradict authenticated revocation evidence', async () => {
    const invalidRecords = [
      revokedRecord({ connectionId: OTHER_CONNECTION_ID }),
      revokedRecord({ workspaceId: OTHER_WORKSPACE_ID }),
      revokedRecord({ userId: OTHER_USER_ID }),
      revokedRecord({ revokedAt: OTHER_REVOKED_AT }),
      Object.freeze({ ...revokedRecord(), status: 'active' }) as unknown as CalendarConnectionRevocationRecord,
    ];

    for (const record of invalidRecords) {
      const application = new CalendarConnectionDisconnectApplication(
        new RecordingRevocationPort(record),
        () => new Date(REVOKED_AT),
      );
      await expect(application.disconnect(AUTHORITY, CONNECTION_ID)).rejects.toThrow(
        'Calendar connection disconnect evidence is invalid',
      );
    }
  });

  it('rejects malformed connection, workspace, and user identifiers before persistence', async () => {
    const invalidCases: readonly [TrustedCalendarUserContext, string][] = [
      [AUTHORITY, 'not-a-uuid'],
      [Object.freeze({ workspaceId: 'bad', userId: USER_ID }), CONNECTION_ID],
      [Object.freeze({ workspaceId: WORKSPACE_ID, userId: 'bad' }), CONNECTION_ID],
    ];

    for (const [authority, connectionId] of invalidCases) {
      const revocations = new RecordingRevocationPort(undefined);
      const application = new CalendarConnectionDisconnectApplication(
        revocations,
        () => new Date(REVOKED_AT),
      );
      await expect(application.disconnect(authority, connectionId)).rejects.toThrow(
        'Calendar connection disconnect input is invalid',
      );
      expect(revocations.calls).toHaveLength(0);
    }
  });

  it('rejects invalid and non-canonical server clocks before persistence', async () => {
    const clocks = [
      () => new Date(Number.NaN),
      () => ({ toISOString: () => '2026-08-10T03:45:00Z' }) as Date,
    ];

    for (const now of clocks) {
      const revocations = new RecordingRevocationPort(undefined);
      const application = new CalendarConnectionDisconnectApplication(
        revocations,
        now,
      );
      await expect(application.disconnect(AUTHORITY, CONNECTION_ID)).rejects.toThrow(
        'Calendar connection disconnect input is invalid',
      );
      expect(revocations.calls).toHaveLength(0);
    }
  });
});
