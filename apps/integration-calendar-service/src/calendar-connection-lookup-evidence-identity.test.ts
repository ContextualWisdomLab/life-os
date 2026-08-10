import { describe, expect, it } from 'vitest';
import {
  CalendarConnectionPersistenceError,
  PostgresCalendarConnectionRepository,
  type CalendarConnectionSqlClient,
  type CalendarConnectionSqlResult,
} from './calendar-connection-repository';

const REQUESTED_CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const CORRUPTED_CONNECTION_ID = '66666666-6666-4666-8666-666666666666';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

class MismatchedLookupClient implements CalendarConnectionSqlClient {
  async query<Row>(): Promise<CalendarConnectionSqlResult<Row>> {
    const row = {
      connection_id: CORRUPTED_CONNECTION_ID,
      workspace_id: WORKSPACE_ID,
      user_id: USER_ID,
      provider_code: 'google',
      provider_account_subject: 'provider-user-123',
      scope_values: ['calendar.read'],
      access_secret_handle: 'kms://life-os/calendar/access-reference-001',
      refresh_secret_handle: 'kms://life-os/calendar/refresh-reference-001',
      token_expires_at: new Date('2026-08-10T10:00:00.000Z'),
      selected_calendar_identifier: 'primary',
      connection_status: 'active',
      created_at: new Date('2026-08-10T09:00:00.000Z'),
      updated_at: new Date('2026-08-10T09:00:00.000Z'),
      revoked_at: null,
    };
    return { rows: [row as Row], rowCount: 1 };
  }
}

describe('Calendar connection lookup durable evidence identity', () => {
  it('rejects a persistence row whose connection identity differs from the requested locator', async () => {
    const repository = new PostgresCalendarConnectionRepository(
      new MismatchedLookupClient(),
    );

    await expect(
      repository.getActiveConnection({
        connectionId: REQUESTED_CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
      }),
    ).rejects.toBeInstanceOf(CalendarConnectionPersistenceError);
  });
});
