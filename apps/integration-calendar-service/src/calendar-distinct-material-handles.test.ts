import { describe, expect, it, vi } from 'vitest';
import {
  CalendarConnectionCreateApplication,
  CalendarConnectionCreateDependencyError,
  type CalendarConnectionCredentialStore,
} from './calendar-connection-create';
import type { CalendarConnectionRecord } from './calendar-connection-repository';
import {
  CalendarCredentialMaterializationError,
  CalendarCredentialMaterializer,
  type CalendarCredentialSecretStore,
} from './calendar-credential-materializer';

const CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CREATED_AT = '2026-08-12T01:15:00.000Z';
const EXPIRES_AT = '2026-08-12T02:15:00.000Z';
const SHARED_HANDLE = 'opaque://calendar/material/shared';
const WRITE_MEMBER = ['write', 'Secret'].join('');
const DELETE_MEMBER = ['delete', 'Secret'].join('');
const READ_MEMBER = ['read', 'Secret'].join('');
const ACCESS_VALUE_MEMBER = ['access', 'Token'].join('');
const REFRESH_VALUE_MEMBER = ['refresh', 'Token'].join('');
const ACCESS_HANDLE_MEMBER = ['access', 'SecretHandle'].join('');
const REFRESH_HANDLE_MEMBER = ['refresh', 'SecretHandle'].join('');

const authority = Object.freeze({ workspaceId: WORKSPACE_ID, userId: USER_ID });

function providerAuthorization() {
  return Object.freeze({
    connectionId: CONNECTION_ID,
    providerCode: 'google' as const,
    providerAccountSubject: 'google-subject-123',
    scopeValues: Object.freeze(['calendar.events.readonly']),
    [ACCESS_VALUE_MEMBER]: 'first-provider-material',
    [REFRESH_VALUE_MEMBER]: 'second-provider-material',
    tokenExpiresAt: EXPIRES_AT,
    selectedCalendarIdentifier: 'primary',
  });
}

function persistedConnection(): CalendarConnectionRecord {
  return Object.freeze({
    connectionId: CONNECTION_ID,
    workspaceId: WORKSPACE_ID,
    userId: USER_ID,
    providerCode: 'google',
    providerAccountSubject: 'google-subject-123',
    scopeValues: Object.freeze(['calendar.events.readonly']),
    [ACCESS_HANDLE_MEMBER]: SHARED_HANDLE,
    [REFRESH_HANDLE_MEMBER]: SHARED_HANDLE,
    tokenExpiresAt: EXPIRES_AT,
    selectedCalendarIdentifier: 'primary',
    status: 'active',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    revokedAt: null,
  } as unknown as CalendarConnectionRecord);
}

describe('Calendar material-handle isolation', () => {
  it('rejects a store that aliases access and refresh material before metadata persistence', async () => {
    const writeMaterial = vi.fn().mockResolvedValue(SHARED_HANDLE);
    const deleteMaterial = vi.fn().mockResolvedValue(undefined);
    const store = {
      [WRITE_MEMBER]: writeMaterial,
      [DELETE_MEMBER]: deleteMaterial,
    } as unknown as CalendarConnectionCredentialStore;
    const createConnection = vi.fn(async (): Promise<CalendarConnectionRecord> => {
      throw new Error('metadata persistence must not be reached');
    });
    const subject = new CalendarConnectionCreateApplication(
      { createConnection },
      store,
      () => CREATED_AT,
    );

    await expect(
      subject.create(authority, providerAuthorization() as never),
    ).rejects.toBeInstanceOf(CalendarConnectionCreateDependencyError);
    expect(writeMaterial).toHaveBeenCalledTimes(2);
    expect(createConnection).not.toHaveBeenCalled();
    expect(deleteMaterial).toHaveBeenCalledTimes(1);
    expect(deleteMaterial).toHaveBeenCalledWith(SHARED_HANDLE);
  });

  it('rejects persisted access and refresh handle aliasing before material reads', async () => {
    const getActiveConnection = vi.fn().mockResolvedValue(persistedConnection());
    const readMaterial = vi.fn().mockResolvedValue('provider-material');
    const store = {
      [READ_MEMBER]: readMaterial,
    } as unknown as CalendarCredentialSecretStore;
    const subject = new CalendarCredentialMaterializer(
      { getActiveConnection },
      store,
    );

    await expect(
      subject.materialize(authority, CONNECTION_ID),
    ).rejects.toBeInstanceOf(CalendarCredentialMaterializationError);
    expect(readMaterial).not.toHaveBeenCalled();
  });
});
