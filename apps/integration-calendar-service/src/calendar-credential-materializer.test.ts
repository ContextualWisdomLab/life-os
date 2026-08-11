import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { TrustedCalendarUserContext } from './calendar-service-context';
import type { CalendarConnectionRecord } from './calendar-connection-repository';
import {
  CalendarCredentialMaterializationError,
  CalendarCredentialMaterializer,
} from './calendar-credential-materializer';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const CONNECTION_ID = '33333333-3333-4333-8333-333333333333';
const ACCESS_MATERIAL = randomBytes(24).toString('base64url');
const REFRESH_MATERIAL = randomBytes(24).toString('base64url');
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
    providerAccountSubject: 'subject-1',
    scopeValues: Object.freeze(['calendar.events']),
    accessSecretHandle: 'kms://calendar/access-33333333',
    refreshSecretHandle: 'kms://calendar/refresh-33333333',
    tokenExpiresAt: '2026-08-12T12:00:00.000Z',
    selectedCalendarIdentifier: 'primary',
    status: 'active',
    createdAt: '2026-08-12T10:00:00.000Z',
    updatedAt: '2026-08-12T10:00:00.000Z',
    revokedAt: null,
    ...overrides,
  });
}

function materializer(record: CalendarConnectionRecord | undefined) {
  const getActiveConnection = vi.fn().mockResolvedValue(record);
  const readSecret = vi.fn(async (handle: string) =>
    handle.includes('/refresh-') ? REFRESH_MATERIAL : ACCESS_MATERIAL,
  );
  return {
    getActiveConnection,
    readSecret,
    subject: new CalendarCredentialMaterializer(
      { getActiveConnection },
      { readSecret },
    ),
  };
}

async function expectMaterializationFailure(
  operation: Promise<unknown>,
): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(
    CalendarCredentialMaterializationError,
  );
}

describe('CalendarCredentialMaterializer', () => {
  it('materializes only the exact active connection inside trusted user authority', async () => {
    const fixture = materializer(connection());

    await expect(
      fixture.subject.materialize(AUTHORITY, CONNECTION_ID),
    ).resolves.toEqual({
      connectionId: CONNECTION_ID,
      providerCode: 'google',
      accessToken: ACCESS_MATERIAL,
      refreshToken: REFRESH_MATERIAL,
      tokenExpiresAt: '2026-08-12T12:00:00.000Z',
      selectedCalendarIdentifier: 'primary',
    });
    expect(fixture.getActiveConnection).toHaveBeenCalledWith({
      connectionId: CONNECTION_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
    });
    expect(fixture.readSecret.mock.calls.map(([handle]) => handle)).toEqual([
      'kms://calendar/access-33333333',
      'kms://calendar/refresh-33333333',
    ]);
  });

  it('fails closed when the connection does not exist and never materializes a secret', async () => {
    const fixture = materializer(undefined);

    await expectMaterializationFailure(
      fixture.subject.materialize(AUTHORITY, CONNECTION_ID),
    );
    expect(fixture.readSecret).not.toHaveBeenCalled();
  });

  it('rejects persistence evidence from another workspace or user before secret access', async () => {
    for (const record of [
      connection({ workspaceId: '44444444-4444-4444-8444-444444444444' }),
      connection({ userId: '55555555-5555-4555-8555-555555555555' }),
      connection({ connectionId: '66666666-6666-4666-8666-666666666666' }),
      connection({ status: 'revoked', revokedAt: '2026-08-12T11:00:00.000Z' }),
    ]) {
      const fixture = materializer(record);
      await expectMaterializationFailure(
        fixture.subject.materialize(AUTHORITY, CONNECTION_ID),
      );
      expect(fixture.readSecret).not.toHaveBeenCalled();
    }
  });

  it('fails closed when secret materialization is unavailable without exposing provider errors', async () => {
    const getActiveConnection = vi.fn().mockResolvedValue(connection());
    const readSecret = vi
      .fn()
      .mockRejectedValue(new Error('provider sensitive-material marker'));
    const subject = new CalendarCredentialMaterializer(
      { getActiveConnection },
      { readSecret },
    );

    let thrown: unknown;
    try {
      await subject.materialize(AUTHORITY, CONNECTION_ID);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CalendarCredentialMaterializationError);
    expect((thrown as Error).message).not.toContain('sensitive-material');
  });

  it('rejects empty, oversized, or control-character secret values', async () => {
    for (const secretValue of ['', 'a'.repeat(16_385), 'material\nvalue']) {
      const getActiveConnection = vi.fn().mockResolvedValue(
        connection({
          refreshSecretHandle: null,
        }),
      );
      const readSecret = vi.fn().mockResolvedValue(secretValue);
      const subject = new CalendarCredentialMaterializer(
        { getActiveConnection },
        { readSecret },
      );

      await expectMaterializationFailure(
        subject.materialize(AUTHORITY, CONNECTION_ID),
      );
    }
  });

  it('supports access-token-only providers without inventing refresh authority', async () => {
    const fixture = materializer(connection({ refreshSecretHandle: null }));

    await expect(
      fixture.subject.materialize(AUTHORITY, CONNECTION_ID),
    ).resolves.toMatchObject({ refreshToken: null });
    expect(fixture.readSecret).toHaveBeenCalledTimes(1);
  });
});
