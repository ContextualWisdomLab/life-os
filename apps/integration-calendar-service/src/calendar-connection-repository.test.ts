import { describe, expect, it } from 'vitest';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';

interface SqlCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

interface SqlResult {
  readonly rows: readonly unknown[];
  readonly rowCount: number | null;
}

class RecordingSqlClient {
  readonly calls: SqlCall[] = [];
  private resultIndex = 0;

  constructor(private readonly results: readonly SqlResult[]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }> {
    this.calls.push({ text, values });
    const result = this.results[this.resultIndex] ?? { rows: [], rowCount: 0 };
    this.resultIndex += 1;
    return result as {
      readonly rows: readonly Row[];
      readonly rowCount: number | null;
    };
  }
}

async function repositoryModule(): Promise<Readonly<Record<string, unknown>>> {
  const modulePath = './calendar-connection-repository';
  return import(modulePath).catch(() => ({}));
}

function createInput(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    connectionId: CONNECTION_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    providerCode: 'google',
    providerAccountSubject: 'provider-user-42',
    scopeValues: ['calendar.events', 'calendar.readonly'],
    accessSecretHandle: 'kms://calendar/access/connection-1111',
    refreshSecretHandle: 'kms://calendar/refresh/connection-1111',
    tokenExpiresAt: '2026-08-10T12:00:00.000Z',
    selectedCalendarIdentifier: 'primary',
    createdAt: '2026-08-10T01:00:00.000Z',
    ...overrides,
  };
}

function storedRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    connection_id: CONNECTION_ID,
    workspace_id: WORKSPACE_ID,
    user_id: USER_ID,
    provider_code: 'google',
    provider_account_subject: 'provider-user-42',
    scope_values: ['calendar.events', 'calendar.readonly'],
    access_secret_handle: 'kms://calendar/access/connection-1111',
    refresh_secret_handle: 'kms://calendar/refresh/connection-1111',
    token_expires_at: new Date('2026-08-10T12:00:00.000Z'),
    selected_calendar_identifier: 'primary',
    connection_status: 'active',
    created_at: new Date('2026-08-10T01:00:00.000Z'),
    updated_at: new Date('2026-08-10T01:00:00.000Z'),
    revoked_at: null,
    ...overrides,
  };
}

describe('PostgresCalendarConnectionRepository', () => {
  it('creates one tenant-and-user-bound connection using secret handles only', async () => {
    const module = await repositoryModule();
    const Repository = module.PostgresCalendarConnectionRepository as new (
      client: RecordingSqlClient,
    ) => { createConnection(input: unknown): Promise<unknown> };
    expect(typeof Repository).toBe('function');
    const client = new RecordingSqlClient([
      { rows: [storedRow()], rowCount: 1 },
    ]);
    const repository = new Repository(client);

    await expect(repository.createConnection(createInput())).resolves.toMatchObject({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      providerCode: 'google',
      selectedCalendarIdentifier: 'primary',
      status: 'active',
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'calendar_integration.calendar_connection_record',
    );
    expect(client.calls[0]?.text).not.toContain(
      'calendar.calendar_connection_record',
    );
    expect(client.calls[0]?.text).toContain('ON CONFLICT (connection_id) DO NOTHING');
    expect(client.calls[0]?.values).toContain('kms://calendar/access/connection-1111');
    expect(client.calls[0]?.values).toContain('kms://calendar/refresh/connection-1111');
    expect(JSON.stringify(client.calls[0]?.values)).not.toContain('access_token');
    expect(JSON.stringify(client.calls[0]?.values)).not.toContain('refresh_token');
  });

  it('compensates the exact attempted row when create evidence is invalid', async () => {
    const module = await repositoryModule();
    const Repository = module.PostgresCalendarConnectionRepository as new (
      client: RecordingSqlClient,
    ) => { createConnection(input: unknown): Promise<unknown> };
    const PersistenceError = module.CalendarConnectionPersistenceError as new () => Error;
    expect(typeof Repository).toBe('function');
    expect(typeof PersistenceError).toBe('function');
    const client = new RecordingSqlClient([
      {
        rows: [
          storedRow({
            user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          }),
        ],
        rowCount: 1,
      },
      { rows: [], rowCount: 1 },
    ]);
    const repository = new Repository(client);

    await expect(repository.createConnection(createInput())).rejects.toBeInstanceOf(
      PersistenceError,
    );

    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]?.text).toContain(
      'DELETE FROM calendar_integration.calendar_connection_record',
    );
    expect(client.calls[1]?.text).toContain('connection_id = $1::uuid');
    expect(client.calls[1]?.text).toContain('workspace_id = $2::uuid');
    expect(client.calls[1]?.text).toContain('user_id = $3::uuid');
    expect(client.calls[1]?.text).toContain('access_secret_handle = $4');
    expect(client.calls[1]?.text).toContain('refresh_secret_handle IS NOT DISTINCT FROM $5');
    expect(client.calls[1]?.values).toEqual([
      CONNECTION_ID,
      WORKSPACE_ID,
      USER_ID,
      'kms://calendar/access/connection-1111',
      'kms://calendar/refresh/connection-1111',
      '2026-08-10T01:00:00.000Z',
    ]);
  });

  it('normalizes scopes and permits an access-only credential handle', async () => {
    const module = await repositoryModule();
    const Repository = module.PostgresCalendarConnectionRepository as new (
      client: RecordingSqlClient,
    ) => { createConnection(input: unknown): Promise<unknown> };
    expect(typeof Repository).toBe('function');
    const client = new RecordingSqlClient([
      {
        rows: [
          storedRow({
            scope_values: ['calendar.events', 'calendar.readonly'],
            refresh_secret_handle: null,
          }),
        ],
        rowCount: 1,
      },
    ]);
    const repository = new Repository(client);

    await repository.createConnection(
      createInput({
        scopeValues: ['calendar.readonly', 'calendar.events', 'calendar.readonly'],
        refreshSecretHandle: null,
      }),
    );

    expect(client.calls[0]?.values).toContainEqual([
      'calendar.events',
      'calendar.readonly',
    ]);
  });

  it('reads an active connection only through connection, workspace, and user scope', async () => {
    const module = await repositoryModule();
    const Repository = module.PostgresCalendarConnectionRepository as new (
      client: RecordingSqlClient,
    ) => { getActiveConnection(input: unknown): Promise<unknown> };
    expect(typeof Repository).toBe('function');
    const client = new RecordingSqlClient([
      { rows: [storedRow()], rowCount: 1 },
    ]);
    const repository = new Repository(client);

    await expect(
      repository.getActiveConnection({
        connectionId: CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
      }),
    ).resolves.toMatchObject({ connectionId: CONNECTION_ID, status: 'active' });

    expect(client.calls[0]?.text).toContain(
      'calendar_integration.calendar_connection_record',
    );
    expect(client.calls[0]?.text).not.toContain(
      'calendar.calendar_connection_record',
    );
    expect(client.calls[0]?.text).toContain('connection_id = $1::uuid');
    expect(client.calls[0]?.text).toContain('workspace_id = $2::uuid');
    expect(client.calls[0]?.text).toContain('user_id = $3::uuid');
    expect(client.calls[0]?.text).toContain("connection_status = 'active'");
    expect(client.calls[0]?.values).toEqual([
      CONNECTION_ID,
      WORKSPACE_ID,
      USER_ID,
    ]);
  });

  it('fails closed before SQL on malformed ownership, provider, secret handle, or token expiry', async () => {
    const module = await repositoryModule();
    const Repository = module.PostgresCalendarConnectionRepository as new (
      client: RecordingSqlClient,
    ) => { createConnection(input: unknown): Promise<unknown> };
    const ValidationError = module.CalendarConnectionValidationError as new () => Error;
    expect(typeof Repository).toBe('function');
    expect(typeof ValidationError).toBe('function');

    for (const invalid of [
      createInput({ workspaceId: 'not-a-uuid' }),
      createInput({ providerCode: 'arbitrary-provider' }),
      createInput({ accessSecretHandle: 'plaintext token value' }),
      createInput({ tokenExpiresAt: 'not-an-instant' }),
      createInput({ scopeValues: [] }),
    ]) {
      const client = new RecordingSqlClient([]);
      const repository = new Repository(client);
      await expect(repository.createConnection(invalid)).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(client.calls).toHaveLength(0);
    }
  });

  it('returns undefined without widening an inaccessible lookup and rejects duplicate persistence evidence', async () => {
    const module = await repositoryModule();
    const Repository = module.PostgresCalendarConnectionRepository as new (
      client: RecordingSqlClient,
    ) => { getActiveConnection(input: unknown): Promise<unknown> };
    const PersistenceError = module.CalendarConnectionPersistenceError as new () => Error;
    expect(typeof Repository).toBe('function');
    expect(typeof PersistenceError).toBe('function');

    const absentClient = new RecordingSqlClient([{ rows: [], rowCount: 0 }]);
    const absentRepository = new Repository(absentClient);
    await expect(
      absentRepository.getActiveConnection({
        connectionId: CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
      }),
    ).resolves.toBeUndefined();

    const duplicateClient = new RecordingSqlClient([
      { rows: [storedRow(), storedRow()], rowCount: 2 },
    ]);
    const duplicateRepository = new Repository(duplicateClient);
    await expect(
      duplicateRepository.getActiveConnection({
        connectionId: CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
      }),
    ).rejects.toBeInstanceOf(PersistenceError);
  });
});
