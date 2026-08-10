import { describe, expect, it } from 'vitest';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const WORKSPACE_BETA = '66666666-6666-4666-8666-666666666666';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const REVOKED_AT = '2026-08-10T02:00:00.000Z';

interface SqlCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

class RecordingSqlClient {
  readonly calls: SqlCall[] = [];

  constructor(private readonly rows: readonly unknown[]) {}

  async query<Row>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }> {
    this.calls.push({ text, values });
    return { rows: this.rows as readonly Row[], rowCount: this.rows.length };
  }
}

async function revocationModule(): Promise<Readonly<Record<string, unknown>>> {
  return import('./calendar-connection-revocation').catch(() => ({}));
}

function revokedRow(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    connection_id: CONNECTION_ID,
    workspace_id: WORKSPACE_ID,
    user_id: USER_ID,
    connection_status: 'revoked',
    revoked_at: new Date(REVOKED_AT),
    ...overrides,
  };
}

describe('PostgresCalendarConnectionRevocationRepository', () => {
  it('atomically revokes only the exact active tenant-and-user-owned connection', async () => {
    const module = await revocationModule();
    const Repository = module.PostgresCalendarConnectionRevocationRepository as new (
      client: RecordingSqlClient,
    ) => { revokeConnection(input: unknown): Promise<unknown> };
    expect(typeof Repository).toBe('function');
    const client = new RecordingSqlClient([revokedRow()]);
    const repository = new Repository(client);

    await expect(
      repository.revokeConnection({
        connectionId: CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        revokedAt: REVOKED_AT,
      }),
    ).resolves.toEqual({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      status: 'revoked',
      revokedAt: REVOKED_AT,
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.text).toContain(
      'UPDATE calendar_integration.calendar_connection_record',
    );
    expect(client.calls[0]?.text).toContain('connection_id = $1::uuid');
    expect(client.calls[0]?.text).toContain('workspace_id = $2::uuid');
    expect(client.calls[0]?.text).toContain('user_id = $3::uuid');
    expect(client.calls[0]?.text).toContain("connection_status = 'active'");
    expect(client.calls[0]?.text).toContain("connection_status = 'revoked'");
    expect(client.calls[0]?.values).toEqual([
      CONNECTION_ID,
      WORKSPACE_ID,
      USER_ID,
      REVOKED_AT,
    ]);
  });

  it('returns undefined for absent, already-revoked, or cross-tenant targets without widening authority', async () => {
    const module = await revocationModule();
    const Repository = module.PostgresCalendarConnectionRevocationRepository as new (
      client: RecordingSqlClient,
    ) => { revokeConnection(input: unknown): Promise<unknown> };
    const client = new RecordingSqlClient([]);
    const repository = new Repository(client);

    await expect(
      repository.revokeConnection({
        connectionId: CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        revokedAt: REVOKED_AT,
      }),
    ).resolves.toBeUndefined();
    expect(client.calls).toHaveLength(1);
  });

  it('fails closed before SQL for malformed ownership or revocation time', async () => {
    const module = await revocationModule();
    const Repository = module.PostgresCalendarConnectionRevocationRepository as new (
      client: RecordingSqlClient,
    ) => { revokeConnection(input: unknown): Promise<unknown> };
    const ValidationError = module.CalendarConnectionRevocationValidationError as new () => Error;
    expect(typeof ValidationError).toBe('function');

    for (const input of [
      {
        connectionId: 'not-a-uuid',
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        revokedAt: REVOKED_AT,
      },
      {
        connectionId: CONNECTION_ID,
        workspaceId: WORKSPACE_ID,
        userId: USER_ID,
        revokedAt: 'not-an-instant',
      },
    ]) {
      const client = new RecordingSqlClient([]);
      const repository = new Repository(client);
      await expect(repository.revokeConnection(input)).rejects.toBeInstanceOf(
        ValidationError,
      );
      expect(client.calls).toHaveLength(0);
    }
  });

  it('fails closed when the database returns duplicate or malformed revocation evidence', async () => {
    const module = await revocationModule();
    const Repository = module.PostgresCalendarConnectionRevocationRepository as new (
      client: RecordingSqlClient,
    ) => { revokeConnection(input: unknown): Promise<unknown> };
    const PersistenceError = module.CalendarConnectionRevocationPersistenceError as new () => Error;
    expect(typeof PersistenceError).toBe('function');

    for (const rows of [
      [revokedRow(), revokedRow()],
      [revokedRow({ workspace_id: WORKSPACE_BETA })],
      [revokedRow({ connection_status: 'active' })],
    ]) {
      const client = new RecordingSqlClient(rows);
      const repository = new Repository(client);
      await expect(
        repository.revokeConnection({
          connectionId: CONNECTION_ID,
          workspaceId: WORKSPACE_ID,
          userId: USER_ID,
          revokedAt: REVOKED_AT,
        }),
      ).rejects.toBeInstanceOf(PersistenceError);
    }
  });
});
