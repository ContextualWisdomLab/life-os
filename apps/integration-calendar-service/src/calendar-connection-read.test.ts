import { describe, expect, it } from 'vitest';
import type { TrustedCalendarUserContext } from './calendar-service-context';
import type {
  CalendarConnectionRecord,
  GetActiveCalendarConnection,
} from './calendar-connection-repository';
import {
  CalendarConnectionReadApplication,
  CalendarConnectionReadEvidenceError,
  type CalendarConnectionReadPort,
} from './calendar-connection-read';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CONNECTION_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_USER_ID = '66666666-6666-4666-8666-666666666666';

const AUTHORITY: TrustedCalendarUserContext = Object.freeze({
  workspaceId: WORKSPACE_ID,
  userId: USER_ID,
});

function connection(
  overrides: Partial<CalendarConnectionRecord> = {},
): CalendarConnectionRecord {
  return Object.freeze({
    connectionId: CONNECTION_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    providerCode: 'google',
    providerAccountSubject: 'provider-account-123',
    scopeValues: Object.freeze(['calendar.readonly']),
    accessSecretHandle: 'kms://calendar/access-123',
    refreshSecretHandle: 'kms://calendar/refresh-123',
    tokenExpiresAt: '2026-08-11T12:00:00.000Z',
    selectedCalendarIdentifier: 'primary',
    status: 'active',
    createdAt: '2026-08-11T09:00:00.000Z',
    updatedAt: '2026-08-11T09:00:00.000Z',
    revokedAt: null,
    ...overrides,
  });
}

class RecordingReadPort implements CalendarConnectionReadPort {
  readonly calls: GetActiveCalendarConnection[] = [];

  constructor(private readonly result: CalendarConnectionRecord | undefined) {}

  async getActiveConnection(
    input: GetActiveCalendarConnection,
  ): Promise<CalendarConnectionRecord | undefined> {
    this.calls.push(input);
    return this.result;
  }
}

describe('CalendarConnectionReadApplication', () => {
  it('derives lookup scope from trusted workspace-user authority and returns credential-free lifecycle evidence', async () => {
    const reads = new RecordingReadPort(connection());
    const application = new CalendarConnectionReadApplication(reads);

    await expect(application.getActive(AUTHORITY, CONNECTION_ID)).resolves.toEqual({
      connectionId: CONNECTION_ID,
      providerCode: 'google',
      scopeValues: ['calendar.readonly'],
      tokenExpiresAt: '2026-08-11T12:00:00.000Z',
      selectedCalendarIdentifier: 'primary',
      status: 'active',
    });
    expect(reads.calls).toEqual([
      {
        connectionId: CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
      },
    ]);
    expect(JSON.stringify(await application.getActive(AUTHORITY, CONNECTION_ID))).not.toContain(
      'kms://',
    );
  });

  it('returns undefined when no active connection exists inside the trusted scope', async () => {
    const application = new CalendarConnectionReadApplication(
      new RecordingReadPort(undefined),
    );

    await expect(application.getActive(AUTHORITY, CONNECTION_ID)).resolves.toBeUndefined();
  });

  it('rejects malformed connection and authority identifiers before persistence', async () => {
    const invalidCases: readonly [TrustedCalendarUserContext, string][] = [
      [AUTHORITY, 'not-a-uuid'],
      [Object.freeze({ workspaceId: 'bad', userId: USER_ID }), CONNECTION_ID],
      [Object.freeze({ workspaceId: WORKSPACE_ID, userId: 'bad' }), CONNECTION_ID],
    ];

    for (const [authority, connectionId] of invalidCases) {
      const reads = new RecordingReadPort(undefined);
      const application = new CalendarConnectionReadApplication(reads);
      await expect(application.getActive(authority, connectionId)).rejects.toThrow(
        'Calendar connection read input is invalid',
      );
      expect(reads.calls).toHaveLength(0);
    }
  });

  it('fails closed when persistence returns authority or lifecycle evidence for another connection', async () => {
    const invalidRecords = [
      connection({ connectionId: OTHER_CONNECTION_ID }),
      connection({ workspaceId: OTHER_WORKSPACE_ID }),
      connection({ userId: OTHER_USER_ID }),
      connection({ status: 'revoked', revokedAt: '2026-08-11T10:00:00.000Z' }),
    ];

    for (const record of invalidRecords) {
      const application = new CalendarConnectionReadApplication(
        new RecordingReadPort(record),
      );
      await expect(application.getActive(AUTHORITY, CONNECTION_ID)).rejects.toBeInstanceOf(
        CalendarConnectionReadEvidenceError,
      );
    }
  });
});
