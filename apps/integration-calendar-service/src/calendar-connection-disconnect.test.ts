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
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const REVOKED_AT = '2026-08-10T03:45:00.000Z';

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

  it('fails closed when persistence returns a record outside the authenticated authority', async () => {
    const revocations = new RecordingRevocationPort(
      revokedRecord({ workspaceId: OTHER_WORKSPACE_ID }),
    );
    const application = new CalendarConnectionDisconnectApplication(
      revocations,
      () => new Date(REVOKED_AT),
    );

    await expect(application.disconnect(AUTHORITY, CONNECTION_ID)).rejects.toThrow(
      'Calendar connection disconnect evidence is invalid',
    );
  });

  it('rejects malformed connection identifiers and non-canonical server clocks before persistence', async () => {
    for (const [connectionId, now] of [
      ['not-a-uuid', () => new Date(REVOKED_AT)],
      [CONNECTION_ID, () => new Date(Number.NaN)],
    ] as const) {
      const revocations = new RecordingRevocationPort(undefined);
      const application = new CalendarConnectionDisconnectApplication(
        revocations,
        now,
      );

      await expect(application.disconnect(AUTHORITY, connectionId)).rejects.toThrow(
        'Calendar connection disconnect input is invalid',
      );
      expect(revocations.calls).toHaveLength(0);
    }
  });
});
